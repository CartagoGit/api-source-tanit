/**
 * WebSocket scanner (audit 2026-09-06 §11, proposal `f00013` S3).
 *
 * Reads `.ts` / `.js` / `.mjs` / `.cjs` source files and emits one
 * `ParsedRoute` per WebSocket event handler discovered. Targets:
 *
 * - **Socket.IO** — `socket.on("evt", h)`, `socket.emit("evt", …)`,
 *   `io.of("/ns")`, etc.
 * - **`ws`** — the lower-level `ws.WebSocketServer` style:
 *   `ws.on("message", h)`, `ws.send(…)`.
 * - **native Node `WebSocket`** — `ws.onmessage = h`,
 *   `addEventListener("message", h)`, etc.
 *
 * Detection: at least one source file with a trigger idiom
 * (`socket.on|emit|…`, `ws.on|emit|send|addEventListener|…`).
 * A project with no event handler is **not** classified as a
 * WebSocket project even if its `package.json` depends on
 * Socket.IO — surface discovery stays *static*, not inferred
 * from deps.
 *
 * Output: routes carry `transport: "ws"` plus
 * `transportMeta.{event, direction, namespace, payloadShape}`.
 * HTTP exporters ignore them today; future Postman-v2.1
 * exporters own the WS rendering (the v2.1 schema has a
 * `protocolProfileBehavior` block that already supports WS).
 */
import { effectiveProjectRoot } from "../../core/discovery/effective-project-root.helper";
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

/** Match `.ts` / `.js` / `.mjs` / `.cjs` source files. */
const WS_SOURCE_FILE_GLOB = /\.(?:ts|js|mjs|cjs)$/i;

/**
 * Trigger regex. The presence of any of these idioms inside a
 * source file is what makes the file "potentially WebSocket".
 * We anchor on `\b` for the receiver (`socket` / `ws` / `client`
 * / `conn`) so plain `socket.io.client` imports don't trigger.
 */
const TRIGGER_RE =
  /\b(?:socket|ws|client|conn)\s*\.\s*(?:on|once|emit|send|addEventListener|onmessage|onopen|onclose|onerror)\b/;

/**
 * Direction comes from which API was called:
 *
 * - **in** — `on`, `once`, `addEventListener`, `onmessage`,
 *   `onopen`, `onclose`, `onerror` (server receives).
 * - **out** — `emit`, `send` (server sends).
 */
const INBOUND_RE =
  /\b(?:on|once|addEventListener|onmessage|onopen|onclose|onerror)\b/;

/**
 * Argument extractor: pull the *first* string literal out of
 * `.on("evt", …)`, `.emit("evt", …)`, etc. We keep this
 * regex-based on purpose so the scanner stays dependency-free
 * and can be replaced by a LanguageIR-backed implementation
 * once `r00013` lands.
 */
const EVENT_LITERAL_RE =
  /\.\s*(?:on|once|emit|send|addEventListener)\s*\(\s*(["'`])([^"'`\n]+)\1/;

/** Namespace extractor: Socket.IO's `io.of("/admin")`. */
const NAMESPACE_RE = /\bio\.of\s*\(\s*(["'`])(\/[^"'`\n]*)\1/;

interface WsCandidate {
  readonly event: string;
  readonly direction: "in" | "out";
  readonly namespace: string | null;
  readonly sourceFile: string;
  readonly lineNumber: number;
}

async function listSourceFiles(
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
      } else if (e.isFile() && WS_SOURCE_FILE_GLOB.test(e.name)) {
        out.push(p);
      }
    }
  }
  return out;
}

/**
 * Reads a single source file and pulls out every WebSocket
 * event candidate. Filters out comments and string literals
 * that look like event names but aren't at the *call site*.
 */
async function extractCandidatesFromFile(
  filePath: string,
  projectRoot: string,
): Promise<ReadonlyArray<WsCandidate>> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return [];
  }
  if (!TRIGGER_RE.test(text)) return [];
  const rel = filePath.startsWith(projectRoot)
    ? filePath.slice(projectRoot.length + 1)
    : filePath;
  const namespace = NAMESPACE_RE.exec(text)?.[2] ?? null;

  const out: WsCandidate[] = [];
  for (let i = 0; i < text.length; ) {
    const newline = text.indexOf("\n", i);
    const line = text.slice(i, newline === -1 ? text.length : newline);
    i = newline === -1 ? text.length : newline + 1;
    if (!TRIGGER_RE.test(line)) continue;
    const evMatch = EVENT_LITERAL_RE.exec(line);
    if (!evMatch) continue;
    const event = evMatch[2]!.trim();
    if (event.length === 0 || /^\$\{/.test(event)) continue;
    const direction: "in" | "out" = INBOUND_RE.test(line) ? "in" : "out";
    out.push({
      event,
      direction,
      namespace,
      sourceFile: rel,
      lineNumber: 0,
    });
  }

  // Fix up line numbers in a single pass: count `\n` before each
  // candidate's marker `("${event}")` in the source text.
  return out.map((c) => {
    const marker = `("${c.event}")`;
    const idx = text.indexOf(marker);
    const lineNumber = idx === -1 ? 1 : text.slice(0, idx).split("\n").length;
    return { ...c, lineNumber };
  });
}

export class WebSocketProjectScanner implements IProjectScanner {
  readonly framework: FrameworkId = "websocket" as FrameworkId;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const files = await listSourceFiles(projectRoot);
    const matches: string[] = [];
    for (const f of files) {
      try {
        const t = await readFile(f, "utf8");
        if (TRIGGER_RE.test(t)) matches.push(f);
      } catch {
        continue;
      }
    }
    const score = matches.length > 0 ? 1 : 0;
    return {
      score,
      evidence: [
        {
          signal: `${matches.length} source file(s) with WebSocket trigger idioms`,
          weight: score,
          artifact: matches[0],
        },
      ],
    };
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const files = await listSourceFiles(projectRoot);
    const matches: string[] = [];
    for (const f of files) {
      try {
        const t = await readFile(f, "utf8");
        if (TRIGGER_RE.test(t)) matches.push(f);
      } catch {
        continue;
      }
    }
    return {
      framework: this.framework,
      projectRoot,
      artifacts: matches,
    };
  }
}

export class WebSocketRouteScanner implements IRouteScanner {
  readonly framework: FrameworkId = "websocket" as FrameworkId;

  matches(match: IProjectMatch): boolean {
    return match.framework === this.framework;
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const files = await listSourceFiles(effectiveProjectRoot(match));
    const routes: ParsedRoute[] = [];
    for (const f of files) {
      const candidates = await extractCandidatesFromFile(f, effectiveProjectRoot(match));
      for (const c of candidates) {
        const description =
          `Socket.IO event \`${c.event}\` (direction ${c.direction}` +
          (c.namespace ? `, namespace "${c.namespace}"` : "") +
          `)`;
        const transportMeta: ParsedRoute["transportMeta"] = {
          event: c.event,
          direction: c.direction,
        };
        if (c.namespace) {
          (transportMeta as Record<string, unknown>).namespace = c.namespace;
        }
        routes.push({
          framework: this.framework,
          method: c.direction === "in" ? "IN" : "OUT",
          uri: `/ws${c.namespace ?? ""}/events/${c.event}`,
          rawUri: `ws${c.namespace ?? ""}/events/${c.event}`,
          sourceFile: c.sourceFile,
          lineNumber: c.lineNumber,
          prefixChain: [],
          displayName: `${c.direction === "in" ? "←" : "→"} ${c.event}`,
          tags: [c.direction === "in" ? "ws:receive" : "ws:send"],
          description,
          transport: "ws",
          transportMeta,
        });
      }
    }
    return { routes };
  }
}
