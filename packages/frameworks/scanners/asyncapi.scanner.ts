/**
 * AsyncAPI scanner (audit 2026-09-06 §11, proposal `f00013` S5).
 *
 * Reads `asyncapi.yaml` / `asyncapi.yml` / `asyncapi.json`
 * documents and emits one `ParsedRoute` per
 * operation (publish / subscribe). The scanner is **regex
 * based** — we do not pull in `@asyncapi/parser` because
 * (a) the proposal already accepts a "minimal" pattern for
 * S2/S3/S4 and (b) adding a parser dep here would be out of
 * scope for the first-cut. Users wanting a richer surface
 * (`oneof`, `$ref` resolution, ...) can swap this scanner.
 *
 * AsyncAPI 2.x surface we extract:
 *
 *   servers.<name>.protocol       → maps to TransportKind
 *     - "kafka"        → "kafka"
 *     - "amqp" / "amqps" → "rabbitmq"
 *     - "nats"         → "nats"
 *     - "mqtt" / "mqtts" → "mqtt"
 *     - "ws" / "wss"   → "ws"
 *     - "http" / "https" → skip (covered by HTTP scanners)
 *
 *   channels.<key>                → emitted as the URI path
 *   operations.<key>.action       → "send" or "receive"
 *   operations.<key>.channel.$ref → resolve to channel key
 *
 * AsyncAPI 3.x uses a slightly different shape (channels
 * split into <address> + <messages>); we leave 3.x to a
 * follow-up slice (`f00013.b` if it lands) and keep S5
 * focused on 2.6 today.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type {
  FrameworkId,
  IProjectMatch,
  IProjectScanner,
  IProjectScannerResult,
  IRouteScanner,
  IScanResult,
  ParsedRoute,
} from "../../contracts/interfaces/core/scanner.interface.js";

const ASYNCAPI_FILES = /asyncapi\.(?:yaml|yml|json)$/i;

/**
 * `servers: <name>: { protocol: kafka }`. We capture
 * `(protocol)` and the closing `}` of the entry so a
 * later `protocol: amqp` doesn't bleed into the match.
 */
const SERVER_PROTOCOL_RE =
  /^[\t ]*servers:[\t ]*$|^\s+[a-zA-Z0-9_-]+:\s*\n(?:\s+\w+:\s*[^\n]+\n)*\s+protocol:\s*(kafka|amqp|amqps|nats|mqtt|mqtts|ws|wss|http|https)\b/gm;

/**
 * `operations: <key>: { action: send, channel: $ref: '...' }`.
 * Captured: (key, action, ref).
 */
const OPERATION_RE =
  /^\s{4}([a-zA-Z0-9_]+):\s*\n(?:\s{8}[a-zA-Z]+:\s*[^\n]+\n)*\s{8}action:\s*(send|receive)\s*\n\s{8}channel:\s*\n\s{12}\$ref:\s*['"]?#\/channels\/([a-zA-Z0-9_./~\- ]+)/gm;

interface AsyncApiServerProtocol {
  name: string;
  protocol: string;
  transport: string;
}

function normaliseProtocol(p: string): string | null {
  switch (p) {
    case "kafka":
      return "kafka";
    case "amqp":
    case "amqps":
      return "rabbitmq";
    case "nats":
      return "nats";
    case "mqtt":
    case "mqtts":
      return "mqtt";
    case "ws":
    case "wss":
      return "ws";
    case "http":
    case "https":
      // HTTP — skip; HTTP scanners cover it.
      return null;
    default:
      return null;
  }
}

async function listAsyncApiFiles(
  projectRoot: string,
): Promise<ReadonlyArray<string>> {
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
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        stack.push(p);
      } else if (e.isFile() && ASYNCAPI_FILES.test(e.name)) {
        out.push(p);
      }
    }
  }
  return out;
}

export class AsyncApiProjectScanner implements IProjectScanner {
  readonly framework: FrameworkId = "asyncapi" as FrameworkId;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const files = await listAsyncApiFiles(projectRoot);
    const score = files.length > 0 ? 1 : 0;
    return {
      score,
      evidence: [
        {
          signal: `${files.length} asyncapi document(s) found`,
          weight: score,
          artifact: files[0],
        },
      ],
    };
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const files = await listAsyncApiFiles(projectRoot);
    return {
      framework: this.framework,
      projectRoot,
      artifacts: files,
    };
  }
}

export class AsyncApiRouteScanner implements IRouteScanner {
  readonly framework: FrameworkId = "asyncapi" as FrameworkId;

  matches(match: IProjectMatch): boolean {
    return match.framework === this.framework;
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const files = await listAsyncApiFiles(match.projectRoot);
    const routes: ParsedRoute[] = [];

    for (const f of files) {
      let text: string;
      try {
        text = await readFile(f, "utf8");
      } catch {
        continue;
      }
      const rel = f.startsWith(match.projectRoot)
        ? f.slice(match.projectRoot.length + 1)
        : f;

      // Resolve the FIRST non-HTTP server protocol — most
      // AsyncAPI documents declare a single server. If
      // multiple non-HTTP servers are declared we still pick
      // the first one; a follow-up slice may fan out per
      // server.
      const protocols: AsyncApiServerProtocol[] = [];
      SERVER_PROTOCOL_RE.lastIndex = 0;
      let pm: RegExpExecArray | null;
      while ((pm = SERVER_PROTOCOL_RE.exec(text)) !== null) {
        if (pm[1]) {
          const normalised = normaliseProtocol(pm[1]);
          if (normalised) protocols.push({ name: "default", protocol: pm[1], transport: normalised });
        }
      }
      if (protocols.length === 0) continue;
      const protocol = protocols[0]!;

      let m: RegExpExecArray | null;
      OPERATION_RE.lastIndex = 0;
      while ((m = OPERATION_RE.exec(text)) !== null) {
        const operationKey = m[1]!;
        const action = m[2]!;
        // AsyncAPI / JSON Pointer escape: ~1 -> /
            const channelRef = m[3]!.trim().replace(/~1/g, "/");
        routes.push({
          framework: this.framework,
          method: action === "send" ? "PUBLISH" : "SUBSCRIBE",
          uri: `/${channelRef.replace(/~/g, "~1").replace(/\//g, "~1")}`,
          rawUri: channelRef,
          sourceFile: rel,
          lineNumber: text.slice(0, m.index).split("\n").length,
          prefixChain: [],
          displayName: `${action === "send" ? "→" : "←"} ${operationKey}`,
          tags: [protocol.protocol, `action:${action}`],
          description: `AsyncAPI operation \`${operationKey}\` (channel \`${channelRef}\`, action \`${action}\`, protocol \`${protocol.protocol}\` → transport \`${protocol.transport}\`)`,
          transport: protocol.transport as ParsedRoute["transport"],
          transportMeta: {
            channel: channelRef,
            event: operationKey,
            direction: action === "send" ? "out" : "in",
          },
        });
      }
    }
    return { routes };
  }
}
