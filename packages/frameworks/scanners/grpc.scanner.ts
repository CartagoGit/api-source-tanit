/**
 * gRPC scanner (audit 2026-09-06 §11, proposal `f00013` S2).
 *
 * Reads `.proto` files and emits one `ParsedRoute` per `rpc`
 * declaration. The scanner is **deliberately minimal** — the goal
 * of this slice is the data model (`transport: "grpc"`,
 * `transportMeta`), not full protobuf parsing. We do not resolve
 * type references across files, do not interpret `oneof`,
 * do not follow `import` statements, and do not parse `package`
 * paths. The output is the service surface (service + method +
 * streaming kind) so the future gRPC exporter can emit a usable
 * collection; consumers wanting richer schemas can swap this
 * scanner for `protolangs` or `protobufjs`.
 *
 * Detection: a project with at least one `*.proto` file at its
 * root and at least one `service` declaration is recognised.
 * Scoring is `1.0` (cap) — a project with `.proto` files is
 * unambiguously a gRPC project.
 *
 * The scanner emits specs with `transport: "grpc"`. HTTP-only
 * exporters ignore them today; future gRPC exporters own the
 * rendering. The Postman exporter falls back to a single request
 * with `method: "POST"` so a user importing the collection
 * never gets an empty folder.
 */
import { effectiveProjectRoot } from "../../core/discovery/effective-project-root.helper";
import { readFile } from "node:fs/promises";
import { ownRegex } from "../../core/helpers/regex.helper.js";
import { join } from "node:path";

import type { IProjectMatch } from "../../contracts/interfaces/core/scanner.interface";
import type {
  IProjectScanner,
  IProjectScannerResult,
  IRouteScanner,
  ParsedRoute,
} from "../../contracts/interfaces/core/scanner.interface.js";

const PROTO_FILE_GLOB = /\.proto$/i;
const SERVICE_RE = /^\s*service\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm;
// Match `rpc X (T1) returns (T2)` where T1 / T2 may be
// prefixed with `stream `. We do not capture the optional
// `stream` because it makes the regex fragile across
// editors' whitespace handling; the substring check below
// figures out streaming kind reliably.
const RPC_RE =
  /\brpc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(?:stream\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*\)\s*returns\s*\(\s*(?:stream\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*\)/gm;

/** Walking a project root and returning every `*.proto` file path. */
async function listProtoFiles(
  projectRoot: string,
): Promise<ReadonlyArray<string>> {
  const { readdir } = await import("node:fs/promises");
  const out: string[] = [];
  const stack = [projectRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        stack.push(full);
      } else if (PROTO_FILE_GLOB.test(entry.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

export class GrpcProjectScanner implements IProjectScanner {
  readonly framework = "grpc" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const protoFiles = await listProtoFiles(projectRoot);
    const score = protoFiles.length > 0 ? 1 : 0;
    return {
      score,
      evidence: [
        {
          signal: `${protoFiles.length} .proto file(s) found`,
          weight: score,
          artifact: protoFiles[0],
        },
      ],
    };
  }

  async resolve(projectRoot: string) {
    const protoFiles = await listProtoFiles(projectRoot);
    return {
      framework: this.framework,
      projectRoot,
      score: protoFiles.length > 0 ? 1 : 0,
      evidence: [],
      artifacts: protoFiles,
    };
  }
}

/** Streaming kind of an `rpc` declaration. */
type Streaming = "unary" | "server-stream" | "client-stream" | "bidi";

export class GrpcRouteScanner implements IRouteScanner {
    matches(match: { readonly framework: string }): boolean {
    return match.framework === this.framework;
  }

  
  readonly framework = "grpc" as const;

  async scan(match: IProjectMatch): Promise<{
    routes: ReadonlyArray<ParsedRoute>;
    validators?: Map<string, never>;
    fields?: Map<string, never>;
    raw?: Map<string, never>;
  }> {
    const protoFiles = await listProtoFiles(effectiveProjectRoot(match));
    const routes: ParsedRoute[] = [];

    for (const file of protoFiles) {
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch {
        continue;
      }
      const root = effectiveProjectRoot(match);
      const relativeFile = file.startsWith(root)
        ? file.slice(root.length).replace(/^\/+/, "")
        : file;

      const serviceRe = ownRegex(SERVICE_RE);
      let serviceMatch: RegExpExecArray | null;
      while ((serviceMatch = serviceRe.exec(text)) !== null) {
        const service = serviceMatch[1]!;
        const blockStart = serviceMatch.index + serviceMatch[0].length;
        const blockEnd = text.indexOf("}", blockStart);
        if (blockEnd === -1) continue;
        const block = text.slice(blockStart, blockEnd);

        const RPC_LOCAL = new RegExp(RPC_RE.source, "gm");
        let rpcMatch: RegExpExecArray | null;
        while ((rpcMatch = RPC_LOCAL.exec(block)) !== null) {
          const method = rpcMatch[1]!;
          // Streaming detection: substring check on each half
          // (the regex matches the type name without the
          // optional `stream ` prefix because the latter
          // complicates the capture). `rpcMatch.index` is the
          // offset of the whole match inside `block`.
          // Streaming kind: we split the matched text on `returns`
          // and check each half for an optional `stream `
          // prefix.
          const split = rpcMatch[0].split(/\s*returns\s*/);
          const requestHalf = split[0] ?? "";
          const responseHalf = split[1] ?? "";
          const requestHasStream = /\(\s*stream\s/.test(requestHalf);
          const responseHasStream = /\(\s*stream\s/.test(responseHalf);
          const streaming: Streaming = requestHasStream && responseHasStream
            ? "bidi"
            : responseHasStream
            ? "server-stream"
            : requestHasStream
            ? "client-stream"
            : "unary";

          // We use `method: "POST"` as a placeholder so the
          // adapter (which today only understands HTTP) keeps the
          // route alive. The real transport signal travels via
          // `tags` until the adapter is generalised (`f00013` S3).
          routes.push({
            framework: "grpc",
            method: "POST",
            uri: `/${service}/${method}`,
            rawUri: `${service}/${method}`,
            sourceFile: relativeFile,
            lineNumber: lineOf(text, blockStart + rpcMatch.index),
            prefixChain: [],
            tags: [service, streaming],
            // Audit 2026-09-06 §11, proposal f00013: the scanner
            // stamps `transport` + `transportMeta` so the
            // adapter propagates them to the EndpointSpec. HTTP
            // exporters ignore specs whose transport is not
            // `"http"`; future gRPC exporters will own the
            // rendering.
            transport: "grpc",
            transportMeta: {
              service,
              method,
              streaming,
            },
          });
        }
      }
    }

    return { routes };
  }
}

/** 0-based offset → 1-based line number. */
function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}
