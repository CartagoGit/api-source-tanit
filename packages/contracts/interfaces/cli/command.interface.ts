/**
 * The shape of a CLI command.
 *
 * It is a contract because **two** places need it and neither owns the
 * other: the dispatcher that runs the command, and the gate that
 * compares the CLI's surface with the app's
 * (`scripts/gates/lint-cli-app-parity.script.ts`).
 */

/** A command of the CLI: what it says it does, and how to run it. */
export interface ICommand {
  /** One line, shown in the help. */
  readonly summary: string;
  /** Loads the module that runs it. */
  load(): Promise<{ main(argv: string[]): Promise<number> }>;
}
