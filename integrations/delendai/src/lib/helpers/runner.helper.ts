/**
 * Pure helpers for running scripts of the Tanit project.
 *
 * Single Responsibility: abstract `Bun.spawn` with timeout, stdout/
 * stderr capture and safe output parsing. No global state, no
 * filesystem dependencies outside the path it is given.
 *
 * The cwd, env and path to `bun` are received as parameters (`ctx:
 * IRunnerContext`); the documented defaults fall back to the global
 * only if the caller does not provide them — which happens in loose
 * tests, never in the plugin flow, where `ctx.workspace.root` is
 * always available.
 */

import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter as pathDelimiter } from "node:path";
import { execSync as stdlibExecSync } from "node:child_process";
import { z } from "zod";
import {
  GenerateReportSchema,
  type IGenerateReport,
  type IRunScriptResult,
} from "../contracts/interfaces/runner.interface";
import { SUPPORTED_REPORT_VERSION } from "../contracts/constants/runner.constant";
import {
  type IRunnerContext,
} from "../contracts/interfaces/runner-context.interface";
import {
  resolveBunBinFromCtx,
  resolveCwd,
  resolveEnv,
} from "./runner-context.helper";
import { BUN_BIN_SNAPSHOT } from "../contracts/constants/runner-snapshot.constant";

// `Bun.spawnSync` avoids the `posix_spawn 'bun' ENOENT` that
// happens when the MCP host starts the plugin under Bun and the
// helper uses `node:child_process.spawnSync` (one indirection level
// that breaks the bun executable inheritance). The plugin assumes
// Bun runtime (its `engines.bun` requires it).
type BunSpawnSync = (opts: {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: "inherit" | "ignore" | "pipe";
  stdout?: "inherit" | "pipe";
  stderr?: "pipe";
  timeout?: number;
}) => {
  exitCode: number;
  /**
   * In **sync** mode with `stdout: "pipe"`, Bun returns the bytes
   * already read, not a stream: `spawnSync` cannot return something
   * that still needs to be consumed. The declaration used to say
   * `ReadableStream`, and both uses dodged it with
   * `as unknown as Uint8Array` — the casting was hiding a wrong
   * declaration instead of fixing it.
   */
  stdout: Uint8Array | undefined;
  stderr: Uint8Array | undefined;
  success: boolean;
};
/** What this helper needs from the global `Bun`, if it exists. */
interface IBunGlobal {
  readonly spawnSync?: BunSpawnSync;
  readonly which?: (bin: string) => string | null;
}

/**
 * Bare `Bun` is a free identifier: outside Bun it is not
 * `undefined`, it is a **ReferenceError** the moment the module is
 * evaluated. With this at the top level, importing the helper from
 * any non-Bun runtime blew up before reaching the `node:child_process`
 * fallback — meaning the "run via plain Node" branch the file itself
 * documents could never be reached.
 *
 * Reading it from `globalThis` returns `undefined` instead, and lets
 * the fallback work. That is what allows the plugin's tests to run
 * under vitest.
 */
const bunGlobal = (globalThis as { Bun?: IBunGlobal }).Bun;
const bunSpawnSync = bunGlobal?.spawnSync;
const useBunSpawn = typeof bunSpawnSync === "function";

/**
 * Resolves the absolute path of the `bun` binary. Inside the host
 * the plugin runs in a Bun process (not Node), but the helper uses
 * `node:child_process.spawnSync` to keep things synchronous; we
 * resolve the absolute path once to survive `env` values that AI
 * hosts trim (some MCP clients filter `PATH` before spawning).
 *
 * If the context already has `bunBin`, it is returned as-is.
 * Otherwise the documented order is followed: explicit env var →
 * `Bun.which` → `command -v bun` → `"bun"` as the last resort, so
 * that `spawnSync` fails with ENOENT (which is readable) instead of
 * guessing.
 */
function resolveBunBin(ctx: IRunnerContext | undefined): string {
  const fromCtx = resolveBunBinFromCtx(ctx);
  if (fromCtx && fromCtx.length > 0) return fromCtx;
  // 1) Explicit env var captured at boot.
  if (BUN_BIN_SNAPSHOT && BUN_BIN_SNAPSHOT.length > 0) return BUN_BIN_SNAPSHOT;
  // 2) `Bun.which` (available in Bun runtime).
  const w = bunGlobal?.which?.("bun");
  if (typeof w === "string" && w.length > 0) return w;
  // 3) `which` via stdlib (covers execution via plain Node).
  try {
    const out = stdlibExecSync("command -v bun", { encoding: "utf8" }).trim();
    if (out.length > 0) return out;
  } catch {
    // ignore — we fall through to the fallback
  }
  // 4) Fallback: let spawnSync try to resolve from PATH.
  return "bun";
}

/**
 * Normalises a cwd for spawnSync. Accepts:
 *   - absolute paths (`/foo/bar`)
 *   - file:// URLs (`file:///foo/bar/`)
 *   - the context's cwd (or `process.cwd()` as a last resort) when
 *     given an empty string or "."
 *
 * `Bun.spawnSync` with `cwd: "file:///..."` fails with ENOENT because
 * it does not understand the prefix — we need a real FS path.
 */
export function normalizeCwd(
  cwd: string | undefined,
  ctx?: IRunnerContext,
): string {
  if (!cwd || cwd === "." || cwd === "./") return resolveCwd(ctx);
  if (cwd.startsWith("file://")) {
    try {
      return new URL(cwd).pathname;
    } catch {
      return cwd;
    }
  }
  return cwd;
}

/**
 * Runs `bun <args...>` directly from a cwd, with timeout.
 * Useful for sub-commands (`bun test <file>`, `bun run <script>`)
 * that are NOT a specific .ts script.
 *
 * Returns `ok=false` if the process exited with a non-zero code or
 * the timeout was reached.
 */
export function runBunCommand(
  args: ReadonlyArray<string>,
  options: {
    readonly cwd: string;
    readonly timeoutMs?: number;
    /**
     * Roots where the CLI may write. The plugin declares them because
     * here the output path is chosen by an agent, not the person in
     * front of the keyboard.
     */
    readonly containRoots?: ReadonlyArray<string>;
    /**
     * Runtime context. If the caller omits `cwd` (rare) the helper
     * falls back to the context's `cwd`, and if that is also missing,
     * to `process.cwd()` (loose test). `env` and `bunBin` follow the
     * same cascade.
     */
    readonly ctx?: IRunnerContext;
  },
): IRunScriptResult {
  const start = Date.now();
  const timeout = options.timeoutMs ?? 60_000;
  const bunBin = resolveBunBin(options.ctx);
  const cmd = [bunBin, ...args];
  const cwd = normalizeCwd(options.cwd, options.ctx);
  const env = resolveEnv(options.ctx);
  const raw = useBunSpawn
    ? runBunSpawnSyncArray([...cmd], cwd, timeout, env)
    : spawnSync(bunBin, [...args], {
        cwd,
        encoding: "utf8",
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });

  return toRunResult(raw, start);
}

/** The raw shape returned by both `spawnSync`s. */
interface IRawSpawnResult {
  readonly error?: Error | undefined;
  readonly status: number | null;
  readonly stdout: string | Uint8Array | null;
  readonly stderr: string | Uint8Array | null;
}

/**
 * Normalises the output of either `spawnSync`.
 *
 * `Bun.spawnSync` and `child_process.spawnSync` return different
 * shapes (one carries `error`, the other may give Buffer or `null`
 * in the streams), so they are unified here and the rest of the
 * plugin reads just one.
 *
 * The detail that matters: when the process **fails to start**
 * (missing cwd, binary not found) `stderr` is not `null`, it is the
 * empty string — and the old `stderr ?? String(error)` here kept the
 * `""`, throwing away the only message that explained the failure.
 * The consumer got `ok: false` with no `detail`, which is the worst
 * possible outcome: you know it failed and not why.
 */
function toRunResult(raw: IRawSpawnResult, startedAt: number): IRunScriptResult {
  const stdout = decodeStream(raw.stdout);
  const stderr = decodeStream(raw.stderr);
  const durationMs = Date.now() - startedAt;

  if (raw.error) {
    return {
      ok: false,
      exitCode: raw.status ?? 1,
      stdout,
      // `||`, not `??`: the case to cover is the empty string.
      stderr: stderr || `${raw.error.name}: ${raw.error.message}`,
      durationMs,
    };
  }
  return { ok: raw.status === 0, exitCode: raw.status ?? 1, stdout, stderr, durationMs };
}

/** Buffer, string or nothing → always string. */
function decodeStream(stream: string | Uint8Array | null | undefined): string {
  if (typeof stream === "string") return stream;
  if (stream instanceof Uint8Array) return new TextDecoder().decode(stream);
  return "";
}

/**
 * Runs a `.ts` script with bun in synchronous mode, with timeout.
 * Returns `ok=false` if the process exited with a non-zero code or
 * the timeout was reached (exit 124).
 */
export function runBunScript(
  scriptPath: string,
  args: ReadonlyArray<string>,
  options: {
    readonly cwd: string;
    readonly timeoutMs?: number;
    /**
     * Roots where the CLI may write. The plugin declares them because
     * here the output path is chosen by an agent, not the person in
     * front of the keyboard.
     */
    readonly containRoots?: ReadonlyArray<string>;
    /**
     * Runtime context. Same cascade as in `runBunCommand`.
     */
    readonly ctx?: IRunnerContext;
  },
): IRunScriptResult {
  const start = Date.now();
  const timeout = options.timeoutMs ?? 60_000;
  const bunBin = resolveBunBin(options.ctx);
  const cmd = [bunBin, "run", scriptPath, ...args];
  const cwd = normalizeCwd(options.cwd, options.ctx);

  // The CLI launched by hand accepts `--output-dir` anywhere, and
  // that's how it should be. Through the plugin it does not: a `../`
  // in an argument must not end up writing in anyone's `$HOME`.
  //
  // The roots are plural because one alone does not describe the
  // legitimate uses — the output can sit next to the scanned
  // project, inside the workspace, or in a temp dir, and all three
  // are reasonable. The temp dir is included on purpose: that is
  // where disposable output goes, and leaving it out would turn the
  // guardrail into a nuisance someone would eventually remove.
  const roots = [...(options.containRoots ?? []), cwd, tmpdir()];
  const baseEnv = resolveEnv(options.ctx);
  const env: Record<string, string | undefined> = {
    ...baseEnv,
    POSTMAN_CONTAIN_ROOT: roots.join(pathDelimiter),
  };

  const result = useBunSpawn
    ? runBunSpawnSyncArray(cmd, cwd, timeout, env)
    : spawnSync(cmd[0] ?? "bun", cmd.slice(1), {
        cwd,
        encoding: "utf8",
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });
  return toRunResult(result, start);
}

function runBunSpawnSyncArray(
  cmd: string[],
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv | undefined,
): {
  error?: Error;
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const envRecord: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env ?? {})) {
    envRecord[k] = v;
  }
  try {
    const r = bunSpawnSync!({
      cmd,
      cwd,
      env: envRecord,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    });
    return {
      status: r.exitCode,
      stdout: r.stdout ? new TextDecoder().decode(r.stdout) : "",
      stderr: r.stderr ? new TextDecoder().decode(r.stderr) : "",
    };
  } catch (err) {
    // Invalid cwd, binary not found, or blocked spawn.
    // We return a "failed" result instead of throwing, so the caller
    // can report it as a step with `ok=false`.
    const e = err as Error;
    return {
      error: e,
      status: null,
      stdout: "",
      stderr: `${e.name}: ${e.message}`,
    };
  }
}


/**
 * Reads the `generate --json` report from the CLI's stdout.
 *
 * Before this, the plugin extracted paths with regexes over the
 * human text (`/Collection written to (.+)/`). It broke silently as
 * soon as the CLI was translated to English: the tool kept returning
 * `ok: true` with `collectionPath: "<not detected>"` and `requests: 0`,
 * i.e. a success that wasn't one. Now the CLI emits a versioned JSON
 * document on stdout (the human trace goes to stderr) and here we
 * just parse and validate it.
 */
export function readGenerateReport(
  stdout: string,
): { ok: true; report: IGenerateReport } | { ok: false; detail: string } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { ok: false, detail: "el CLI no ha escrito nada en stdout" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      detail:
        "stdout no es JSON — ¿se ha lanzado `generate` sin `--json`? " +
        `Primeros 200 caracteres: ${trimmed.slice(0, 200)}`,
    };
  }

  const parsed = GenerateReportSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      detail: `el informe del CLI no encaja con el contrato: ${parsed.error.message}`,
    };
  }
  if (parsed.data.version !== SUPPORTED_REPORT_VERSION) {
    return {
      ok: false,
      detail:
        `el CLI emite la versión ${parsed.data.version} del informe y este ` +
        `plugin lee la ${SUPPORTED_REPORT_VERSION}. Actualiza el plugin.`,
    };
  }
  return { ok: true, report: parsed.data };
}
