/**
 * Runtime context that `runner.helper` needs to invoke the CLI.
 *
 * The plugin runs inside a long-lived delendai host, and that host
 * already has a `ctx.workspace` and a set of Zod-validated `options`.
 * What the runner needs comes from there:
 *
 *   - `cwd`: the host's workspace, or the `projectRoot` requested by
 *     the agent. Do NOT read from `process.cwd()`: it depends on
 *     where the host was started and changes between dev and prod.
 *   - `env`: the subset of the environment the CLI should inherit.
 *     The host filters it (some AI clients strip `PATH` and similar);
 *     the plugin must pass it explicitly so tests don't depend on
 *     whoever is running the suite's shell.
 *   - `bunBin`: absolute path to the `bun` binary. The host resolves
 *     it once at boot and injects it; if the agent needs to override
 *     it, they can also set it via `DELENDAI_BUN_BIN` (the runner
 *     reads it when `bunBin` is not passed).
 *
 * Every field is optional: if missing, the runner falls back to its
 * documented default (the boot snapshot in `process-snapshot.helper`,
 * `Bun.which("bun")`, and `"bun"` as the last resort).
 *
 * Design:
 *   - Narrow interface, not a class. Satisfies the universal §6: the
 *     consumer depends on the abstraction, not the implementer.
 *   - Readonly so nothing mutates it while a spawn is in flight.
 */
export interface IRunnerContext {
  /** Spawn working dir. Default: the cwd snapshot at boot. */
  readonly cwd?: string;
  /** Environment to inherit for the subprocess. Default: the env snapshot at boot. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Absolute path to the `bun` binary. Default: `DELENDAI_BUN_BIN` → `Bun.which("bun")` → `command -v bun` → `"bun"`. */
  readonly bunBin?: string;
}
