/**
 * What to say when an operation has no handler yet.
 *
 * ## Why this file exists
 *
 * The app asks for the pending operations **on purpose**: that is
 * what keeps the backlog honest, and the gate
 * (`lint:cli-app-parity`) fails if the app stops asking for one of
 * them. But a call that cannot work has to say so in words a person
 * can read — and, when the CLI can already do it, say which command
 * does it.
 *
 * Three of the four screens that reach for a pending operation had
 * no `catch`: the call rejected, the rejection was unhandled, and the
 * screen kept whatever message it had — which is nothing. The user
 * pressed a button and nothing happened, with no error anywhere.
 *
 * So the rule here is simple: **a pending operation always leaves a
 * trace**. Either it works, or it says what to do instead.
 */

/** The CLI command that does what the handler does not. */
const CLI_EQUIVALENT: Readonly<Record<string, string>> = {
  check: "apisrc check --project-root <path>",
  sync: "apisrc sync --project-root <path>",
  validate: "apisrc validate --project-root <path>",
  push: "apisrc push --project-root <path> --workspace <id>",
};

/**
 * A sentence that says what went wrong and what to do about it.
 *
 * @param operation - The pending operation that was asked for.
 * @param error - Whatever the carrier rejected with.
 */
export function describePending(operation: string, error: unknown): string {
  const command = CLI_EQUIVALENT[operation];
  const reason = reasonOf(error);
  if (command === undefined) {
    return `This action is not available in the app yet${reason === null ? "." : `: ${reason}`}`;
  }
  return `This action is CLI-only for now${reason === null ? "." : `: ${reason}`} The CLI can do it: ${command}.`;
}

/** The carrier's own words, when it gave any. */
function reasonOf(error: unknown): string | null {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim() !== "") {
    return error.trim();
  }
  return null;
}
