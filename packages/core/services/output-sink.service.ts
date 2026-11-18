/**
 * Concrete output sinks used by the CLI commands.
 *
 * The `--json` mode used to monkey-patch `console.log` to redirect
 * human output to stderr. That broke the rule "no `process.stdout` /
 * `process.stderr` from engines" (universal §6, mirrored by
 * `scripts/gates/lint-tool-no-process.script.ts`) and made tests
 * brittle: every test had to swap `console.log` back.
 *
 * The two sinks below let the caller pick behaviour at construction
 * time. No global state, no monkey-patching, no test teardown needed.
 *
 * @see packages/contracts/interfaces/core/output-sink.interface.ts
 */

import type { IOutputSink } from "../../contracts/interfaces/core/output-sink.interface.js";

/** Sink for the normal (human) mode: write to stdout, errors to stderr. */
export class ConsoleOutputSink implements IOutputSink {
  write(message: string): void {
    process.stdout.write(`${message}\n`);
  }

  writeError(message: string): void {
    process.stderr.write(`${message}\n`);
  }

  writeJson(payload: string): void {
    process.stdout.write(`${payload}\n`);
  }
}

/**
 * Sink for `--json` mode: human traces go to stderr (stdout is reserved
 * for the JSON report), errors go to stderr, JSON report goes to stdout.
 */
export class JsonModeConsoleSink implements IOutputSink {
  write(message: string): void {
    process.stderr.write(`${message}\n`);
  }

  writeError(message: string): void {
    process.stderr.write(`${message}\n`);
  }

  writeJson(payload: string): void {
    process.stdout.write(`${payload}\n`);
  }
}

/**
 * Pick a sink based on whether `--json` is present.
 *
 * Callers (the CLI scripts) call this once with the parsed flags and
 * pass the sink down. There is no global state — two CLI invocations in
 * the same process can pick different sinks without interference.
 */
export function selectOutputSink(options: { jsonMode: boolean }): IOutputSink {
  return options.jsonMode ? new JsonModeConsoleSink() : new ConsoleOutputSink();
}