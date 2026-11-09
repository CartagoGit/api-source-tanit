/**
 * Output sink — injectable, replaces the historical
 * `console.log = (...) => { ... }` monkey-patch in `generate.script.ts`
 * (c00010 S1, audit 2026-09-07 §3.1).
 *
 * Two implementations live in `packages/core/services/output-sink.service.ts`:
 *
 *  - {@link ConsoleOutputSink}        — `write` → `process.stdout`,
 *                                       `writeError` → `process.stderr`.
 *  - {@link JsonModeConsoleSink}      — `write` → `process.stderr`
 *                                       (keeps stdout clean for the JSON
 *                                       report), `writeError` → `process.stderr`,
 *                                       `writeJson` → `process.stdout`.
 *
 * Selection happens once at the top of `runGenerate` based on
 * `--json`. The rest of the script never touches `console.log`,
 * `process.stdout` or `process.stderr` directly; it consumes the sink.
 */

export interface IOutputSink {
  /**
   * Human-readable trace for the user.
   *
   * In normal mode this writes to `stdout`. In `--json` mode it writes
   * to `stderr` so the JSON report keeps the stdout channel.
   */
  write(message: string): void;

  /** Error or warning output. Always stderr. */
  writeError(message: string): void;

  /**
   * Write a structured payload (typically the JSON report in `--json`
   * mode) to `stdout`. Implementations MUST write to stdout even in
   * `--json` mode; this is the channel reserved for the report.
   */
  writeJson(payload: string): void;
}