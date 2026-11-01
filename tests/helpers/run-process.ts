/**
 * Spawn a process from a test, in a portable way.
 *
 * Tests that exercise the CLI or the compiled binary need to start a
 * real process. They used `Bun.spawn`, which only exists when the
 * runner IS bun: under vitest the tests run in Node workers and `Bun`
 * is not defined. This helper uses `node:child_process`, which works
 * in both.
 *
 * It returns stdout and stderr both separately **and** concatenated,
 * because most assertions are of the form "the CLI said this
 * somewhere" and splitting the search across two streams only
 * produces brittle tests.
 */
import { spawn } from "node:child_process";

/** Full output from an already-finished process. */
export interface IProcessResult {
  /** Exit code. `-1` if killed by a signal. */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** `stdout + stderr`, for assertions that do not distinguish. */
  readonly output: string;
}

/** Spawn options. */
export interface IRunProcessOptions {
  readonly cwd?: string;
  /** Variables added on top of the current process's environment. */
  readonly env?: Record<string, string | undefined>;
  /**
   * Exact environment, inheriting nothing from the current process.
   *
   * Used by the compiled-binary test: it strips `PATH` so neither bun
   * nor node is available, to verify the executable is truly
   * self-contained. If this inherited the environment, the test would
   * always pass and prove nothing.
   */
  readonly exactEnv?: Record<string, string>;
  /** Milliseconds before killing it. Defaults to 120 s. */
  readonly timeoutMs?: number;
}

/**
 * Runs `command args…` and waits for it to finish.
 *
 * It never throws on a non-zero exit code: the code is part of the
 * result, and many tests assert on it on purpose. It does throw if
 * the binary cannot be executed (ENOENT) — that is a test failure.
 */
export function runProcess(
  command: string,
  args: readonly string[],
  options: IRunProcessOptions = {},
): Promise<IProcessResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: options.exactEnv ?? { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const decoder = new TextDecoder();
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += decoder.decode(chunk, { stream: true })));
    child.stderr?.on("data", (chunk) => (stderr += decoder.decode(chunk, { stream: true })));

    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => child.kill("SIGKILL"),
      options.timeoutMs ?? 120_000,
    );

    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, stdout, stderr, output: stdout + stderr });
    });
  });
}
