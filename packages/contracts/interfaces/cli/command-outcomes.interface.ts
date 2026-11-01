/**
 * What each CLI command returns, as data.
 *
 * Each command exposes a `run*()` that returns its `Outcome` and
 * a `main()` that prints it. That split exists because **the MCP
 * plugin needs the data**: regex-parsing the CLI's table output
 * breaks the day a column changes, and that hack had already been
 * paid for here.
 *
 * The `Outcome`s live in contracts, not inside each script, for
 * the same reason: two worlds that should not know each other
 * consume them — the command that produces them and the tool
 * that exposes them — and with the type glued to the script the
 * plugin had to import the whole command, with its scanner
 * registry behind, just to know the shape of the data.
 */

import type { IGenerateReport } from "../core/generate-report.interface.js";
import type { ICheckReport } from "../core/application-api.interface.js";

/** A collection endpoint, as data. */
export interface IListedEndpoint {
  readonly method: string;
  readonly uri: string;
  readonly name: string;
  readonly folder: string;
  readonly zone: string;
}

/** What `list` returns: exit code and the endpoints. */
export interface IListOutcome {
  readonly code: number;
  readonly endpoints: ReadonlyArray<IListedEndpoint>;
}

/**
 * Drift between source and collection, as data.
 *
 * The report is declared in the core's contract, because the
 * comparison is not a CLI thing any more: the Application API answers
 * it, and the MCP plugin reads it. It is re-exported here so the
 * plugin's import keeps working — a declaration that lives in two
 * places is a declaration that answers two questions.
 */
export type { ICheckReport, IDriftedEndpoint } from "../core/application-api.interface.js";

/** What `check` returns: exit code and report. */
export interface ICheckOutcome {
  readonly code: number;
  readonly report: ICheckReport | null;
}

/**
 * What a generation returns: the exit code and the report.
 *
 * The report is **always** built, not only with `--json`. Before it
 * only existed inside that `if`, so any other consumer -- `apisrc ui`,
 * a test, the plugin -- had to call the pipeline again or parse the
 * screen output. Both are a second implementation, and a second
 * implementation drifts.
 */
export interface IGenerateOutcome {
  readonly code: number;
  readonly report: IGenerateReport | null;
}
