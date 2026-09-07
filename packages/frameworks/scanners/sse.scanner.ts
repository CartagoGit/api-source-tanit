/**
 * SSE scanner (audit 2026-09-06 §11, proposal `f00013` S4).
 *
 * Detects Server-Sent Events handlers in `.ts` / `.js` source
 * files. The scanner looks for two complementary signals:
 *
 * 1. **HTTP entry-point** that *sets* `Content-Type:
 *    text/event-stream` (the route becomes `transport: "sse"`
 *    instead of `transport: "http"`).
 * 2. **Per-event `event:` markers** inside the handler:
 *    `res.write(\`event: ${name}\\n\`)` /
 *    `res.write("event: tick\\n")` produce named
 *    sub-routes; unnamed `data:` payloads produce one route
 *    with `eventName: null`.
 *
 * `f00013` originally proposed a "specialize the HTTP
 * endpoint" architecture (the SSE scanner receives the
 * HTTP-detected `IEndpoint` and re-tags it). For the
 * first-cut we ship a self-contained scanner instead —
 * it keeps the registry flat (one scanner per family) and
 * the specialisation can come in `f00013.b` once we've
 * confirmed both halves play well together in CI.
 *
 * Two delivery modes per entry point:
 *   - **http** — `app.get(path, handler)` paired with
 *     `res.setHeader('Content-Type', 'text/event-stream')`.
 *   - **declarative** — `addEventSource(path, config)` /
 *     Hono's `streamSSE()` (we keep both literals for now).
 */
import { effectiveProjectRoot } from "../../core/discovery/effective-project-root.helper";
import { readFile, readdir } from "node:fs/promises";
import { ownRegex } from "../../core/helpers/regex.helper.js";
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

const SSE_SOURCE_FILE_GLOB = /\.(?:ts|js|mjs|cjs)$/i;

/**
 * Files containing the SSE `Content-Type` header are the
 * entry points — every other signal below is gated by this
 * trigger. We anchor on `text/event-stream` so plain
 * `application/event-stream` typos don't false-positive.
 */
const SSE_HEADER_RE =
  /['"`]Content-Type['"`]\s*,\s*['"`]text\/event-stream['"`]/;

/**
 * Path of the route handler: `app.get('/events', …)` /
 * `app.post('/stream', …)` / `router.get('/sse', …)` …
 * The `\s+` between method and path absorbs line breaks.
 */
const ROUTE_RE =
  /\b(?:app|router|server)\s*\.\s*(?:get|post|put|delete|patch|all)\s*\(\s*(["'`])([^"'`\n]+)\1/g;

/**
 * `event:` markers inside the handler. We capture the
 * named event (e.g. `tick`, `update`). `data:` lines
 * without a preceding `event:` line produce an unnamed
 * route (`eventName: null`).
 */
const EVENT_NAME_RE =
  /\b(?:res|response|writable)\s*\.\s*write(?:File)?\s*\(\s*(?:["'`])(?:event:)\s*([a-zA-Z_][a-zA-Z0-9_-]*)/g;

interface SseCandidate {
  readonly path: string;
  readonly eventName: string | null;
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
      } else if (e.isFile() && SSE_SOURCE_FILE_GLOB.test(e.name)) {
        out.push(p);
      }
    }
  }
  return out;
}

async function extractCandidatesFromFile(
  filePath: string,
  projectRoot: string,
): Promise<ReadonlyArray<SseCandidate>> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return [];
  }
  if (!SSE_HEADER_RE.test(text)) return [];

  const rel = filePath.startsWith(projectRoot)
    ? filePath.slice(projectRoot.length + 1)
    : filePath;
  const out: SseCandidate[] = [];
  const seen = new Set<string>();

  // Find every route declaration. The method/verb doesn't
  // matter for SSE — most SSE endpoints use GET — but we
  // record it in `transportMeta` for completeness.
  let m: RegExpExecArray | null;
  while ((m = ownRegex(ROUTE_RE).exec(text)) !== null) {
    const path = m[2]!;
    if (!path.startsWith("/")) continue;
    const key = `${path}|__default__`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      path,
      eventName: null,
      sourceFile: rel,
      lineNumber: text.slice(0, m.index).split("\n").length,
    });
  }

  // Find every named event marker; emit one route per
  // (path, eventName). We can't always tie `event: foo` to
  // a specific route declaration, so we fall back to the
  // *first* HTTP route we saw above; if there is none, we
  // skip the event (the user is using `data:` only, not
  // `event:`).
  if (out.length > 0) {
    const firstPath = out[0]!.path;
    const eventNames = new Set<string>();
    let em: RegExpExecArray | null;
    EVENT_NAME_RE.lastIndex = 0;
    while ((em = ownRegex(EVENT_NAME_RE).exec(text)) !== null) {
      eventNames.add(em[1]!);
    }
    for (const ev of eventNames) {
      out.push({
        path: firstPath,
        eventName: ev,
        sourceFile: rel,
        lineNumber: text
          .slice(0, text.search(new RegExp(`event:\\s*${ev}\\b`)))
          .split("\n").length,
      });
    }
  }

  return out;
}

export class SseProjectScanner implements IProjectScanner {
  readonly framework: FrameworkId = "sse" as FrameworkId;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const files = await listSourceFiles(projectRoot);
    const matches: string[] = [];
    for (const f of files) {
      try {
        const t = await readFile(f, "utf8");
        if (SSE_HEADER_RE.test(t)) matches.push(f);
      } catch {
        continue;
      }
    }
    const score = matches.length > 0 ? 1 : 0;
    return {
      score,
      evidence: [
        {
          signal: `${matches.length} source file(s) serving text/event-stream`,
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
        if (SSE_HEADER_RE.test(t)) matches.push(f);
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

export class SseRouteScanner implements IRouteScanner {
  readonly framework: FrameworkId = "sse" as FrameworkId;

  matches(match: IProjectMatch): boolean {
    return match.framework === this.framework;
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const files = await listSourceFiles(effectiveProjectRoot(match));
    const routes: ParsedRoute[] = [];
    for (const f of files) {
      const candidates = await extractCandidatesFromFile(f, effectiveProjectRoot(match));
      for (const c of candidates) {
        routes.push({
          framework: this.framework,
          method: "GET",
          uri: c.path,
          rawUri: c.path,
          sourceFile: c.sourceFile,
          lineNumber: c.lineNumber,
          prefixChain: [],
          displayName:
            c.eventName === null
              ? `SSE ${c.path}`
              : `SSE ${c.path} — ${c.eventName}`,
          tags: ["sse"],
          description:
            c.eventName === null
              ? `Server-Sent Events endpoint ${c.path} (default message frame)`
              : `Server-Sent Events endpoint ${c.path} emitting named event "${c.eventName}"`,
          transport: "sse",
          transportMeta: {
            event: c.eventName ?? undefined,
            channel: c.path,
          },
        });
      }
    }
    return { routes };
  }
}
