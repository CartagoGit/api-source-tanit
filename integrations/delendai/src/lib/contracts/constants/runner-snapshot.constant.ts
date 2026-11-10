/**
 * Immutable snapshot of `process.env` and `process.cwd()` captured at
 * plugin boot.
 *
 * The universal §6 says "Async I/O only in hot paths; `*Sync` is
 * boot-time only" — capturing a snapshot of the process environment
 * **is** boot-time: it happens once when the module loads, not on
 * every tool call. The result is `readonly`, so nothing can mutate
 * it while a spawn is in flight.
 *
 * Why it exists:
 *   - `runner.helper` needs `env` and `bunBin` to invoke the CLI.
 *   - `IMcpPluginContext` does not expose `env` directly (it leaves
 *     that decision to the plugin).
 *   - `lint:tools` (universal §6, mirrored by `lint-tool-no-process`)
 *     forbids reading `process.env` from tools and helpers.
 *
 * The solution: read it **once** here, expose the snapshot as
 * constants, and let the rest of the plugin consume them. That
 * satisfies universal §6 without forcing the host to inject an
 * arbitrary env.
 */

/** Snapshot of the environment captured at module load. */
export const ENV_SNAPSHOT: Readonly<Record<string, string | undefined>> =
  Object.freeze({ ...process.env });

/** Snapshot of the cwd captured at module load. */
export const CWD_SNAPSHOT: string = process.cwd();

/**
 * Snapshot of the `bun` binary, with the documented cascade:
 *   1. `DELENDAI_BUN_BIN` from the captured environment (operator override).
 *   2. `undefined` so `runner.helper` applies its own fallback
 *      (Bun.which / command -v / "bun").
 *
 * The `Bun.which("bun")` helper does not enter the snapshot because it
 * is only available in the Bun runtime and is queried on every spawn
 * (it is cheap, and if the host switches binaries mid-session the
 * helper picks it up).
 */
export const BUN_BIN_SNAPSHOT: string | undefined = (() => {
  const fromEnv = ENV_SNAPSHOT["DELENDAI_BUN_BIN"];
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return undefined;
})();
