#!/usr/bin/env bun
/**
 * `apisrc serve` — the Application API as a long-lived service.
 *
 * Two carriers, one registry:
 *
 *   - `--stdio`: newline-delimited JSON-RPC 2.0 over stdin/stdout.
 *     No token, no Origin. The Tauri sidecar (Tanit Desktop) uses
 *     this mode — IPC is local; only the user can reach it.
 *   - `--http`:  HTTP/1.1 on `127.0.0.1`, with the same security
 *     envelope the existing `apisrc ui` enforces (loopback + token
 *     + Origin). The browser carrier speaks it.
 *
 * Both carriers call the same `HandlerRegistry` from
 * `packages/core/application-api/handlers.ts`. Zero handler logic
 * duplicated; the bridge files are the only place that knows which
 * carrier is active.
 *
 * Usage:
 *   apisrc serve --stdio              # sidecar mode (default)
 *   apisrc serve --http --port 4771   # browser/UI mode
 *   apisrc serve --stdio --workspace /path/to/api
 */
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import {
  buildRegistry,
} from "../../core/application-api/handlers.js";
import {
  defaultOrchestrator,
} from "../../frameworks/index.js";
import type {
  IDiscoveryOrchestrator,
} from "../../contracts/interfaces/core/scanner.interface.js";
import { hasFlag, readFlag } from "../../core/helpers/argv.helper.js";
import { serveStdio } from "../../core/transport/stdio-bridge.server.js";
import {
  startHttpBridge,
  type IHttpBridge,
} from "../../core/transport/http-bridge.server.js";
import type {
  IProjectContext,
} from "../../contracts/interfaces/core/project-context.interface.js";

/**
 * Returns the orchestrator the registry handlers expect.
 *
 * `defaultOrchestrator()` (from `packages/frameworks/index.js`)
 * is the canonical factory the CLI's other commands use; reusing
 * it here means `apisrc serve` dispatches to the **same** scanners
 * as `apisrc generate`, `apisrc inspect`, ... without a second
 * registry to keep in sync.
 */
function buildOrchestrator(): IDiscoveryOrchestrator {
  return defaultOrchestrator();
}

/**
 * Entry point used by both the CLI dispatch (`cli.script.ts`) and
 * the stdio bridge's self-invocation fallback (when the file is run
 * with `bun run` directly).
 *
 * Returns the process exit code. `0` on a clean shutdown, `2` on a
 * fatal startup error.
 */
export async function runServe(
  argv: readonly string[],
  context?: IProjectContext,
): Promise<number> {
  // Mode resolution: stdio is the default (the documented
  // sidecar entry). HTTP is opt-in via `--http` or `--port`.
  // Both flags trigger HTTP mode because the sidecar rarely
  // needs a port flag.
  const wantsHttp =
    hasFlag(argv, "--http") || hasFlag(argv, "--port");
  const isHttp = wantsHttp;
  const isStdio = !isHttp;

  // Workspace resolution: `--workspace` is preferred (sidecar
  // contract); when missing we fall back to `resolveProjectContext`
  // (the same path `apisrc generate` uses).
  const workspaceFlag = readFlag(argv, "--workspace");
  const projectContext =
    workspaceFlag !== undefined
      ? { projectRoot: workspaceFlag }
      : (context ?? resolveProjectContext({ argv: [...argv] }));

  const registry = buildRegistry();
  const orchestrator = buildOrchestrator();

  try {
    if (isHttp) {
      const portFlag = readFlag(argv, "--port");
      const port = portFlag !== undefined ? Number(portFlag) : 0;
      if (Number.isNaN(port) || port < 0 || port > 65535) {
        // eslint-disable-next-line no-console
        console.error(`[serve] invalid --port: ${portFlag}`);
        return 2;
      }
      return await runHttpMode({
        registry,
        workspace: projectContext.projectRoot,
        orchestrator,
        port,
      });
    }
    if (isStdio) {
      return await runStdioMode({
        registry,
        workspace: projectContext.projectRoot,
        orchestrator,
      });
    }
    // Defensive default: stdio (the loop above already covers this).
    return await runStdioMode({
      registry,
      workspace: projectContext.projectRoot,
      orchestrator,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[serve] fatal:", (err as Error).message ?? err);
    return 2;
  }
}

async function runStdioMode(opts: {
  registry: ReturnType<typeof buildRegistry>;
  workspace: string;
  orchestrator: IDiscoveryOrchestrator;
}): Promise<number> {
  const bridge = serveStdio({
    registry: opts.registry,
    input: makeStdinSource(),
    output: { write: (line) => process.stdout.write(line) },
    workspace: opts.workspace,
    orchestrator: opts.orchestrator,
    onError: (err) => {
      // eslint-disable-next-line no-console
      console.error("[serve:stdio] frame error:", (err as Error).message ?? err);
    },
  });

  await waitForShutdown();
  bridge.close();
  await bridge.closed;
  return 0;
}

async function runHttpMode(opts: {
  registry: ReturnType<typeof buildRegistry>;
  workspace: string;
  orchestrator: IDiscoveryOrchestrator;
  port: number;
}): Promise<number> {
  let server: IHttpBridge | null = null;
  try {
    server = startHttpBridge({
      registry: opts.registry,
      ...(opts.port > 0 ? { port: opts.port } : {}),
      workspace: opts.workspace,
      orchestrator: opts.orchestrator,
      caller: "browser",
    });
    // eslint-disable-next-line no-console
    console.log(
      `[serve:http] listening on ${server.url}` +
        `\n  token: ${server.token}` +
        `\n  POST ${server.url}/api  with header x-tanit-token: <token>`,
    );
    await waitForShutdown();
    return 0;
  } finally {
    server?.stop();
  }
}

/* ────────────────────────────────────────────────────────────────────── *
 * Stdin helpers                                                          *
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Line-buffered stdin source.
 *
 * The bridge takes an `AsyncIterable<string>` and pulls one line at
 * a time. The project's `interactive.script.ts` already proves the
 * pattern: split the byte stream on `\r?\n`, keep the trailing
 * partial line for the next read.
 *
 * This avoids depending on `node:readline` (not in the binary) and
 * matches the existing project's discipline: minimal ambient
 * declarations, no extra runtime deps.
 */
function makeStdinSource(): AsyncIterable<string> {
  return readLinesFromStdin();
}

async function* readLinesFromStdin(): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let rest = "";
  const iterator = Bun.stdin.stream()[Symbol.asyncIterator]();
  while (true) {
    const chunk = await iterator.next();
    if (chunk.done) {
      if (rest.length > 0) yield rest;
      return;
    }
    rest += decoder.decode(chunk.value, { stream: true });
    const parts = rest.split(/\r?\n/);
    rest = parts.pop() ?? "";
    for (const part of parts) {
      if (part.length > 0) yield part;
    }
  }
}

/* ────────────────────────────────────────────────────────────────────── *
 * Signal handling — clean shutdown on SIGINT / SIGTERM.                  *
 * ────────────────────────────────────────────────────────────────────── */

function waitForShutdown(): Promise<void> {
  return new Promise<void>((resolve) => {
    const onSignal = (): void => {
      resolve();
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}

/**
 * CLI entry — when the file is invoked directly (`bun run` /
 * `bunx`), dispatch to `main()`. When imported as a module, only
 * `runServe()` is exported.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return runServe(argv);
}

if (import.meta.main) {
  void main().then((code) => {
    process.exit(code);
  });
}