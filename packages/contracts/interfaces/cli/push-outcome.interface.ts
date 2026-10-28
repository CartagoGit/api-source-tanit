/**
 * What pushing the collection to Postman returns.
 *
 * There is one rule here that is not in the other `Outcome`s: **the
 * API key does not appear**. Neither the value, nor a masked
 * version, nor the variable name it came from.
 *
 * This is not abstract caution. `push` is the only command that
 * handles a secret, and it is exactly the one an agent will invoke
 * by itself: whatever it returns ends up in a conversation
 * history, in a host log, or echoed back by the model. A Postman
 * API `detail` carrying the full request would leak the key
 * without anyone having decided to.
 *
 * Hence the error travels as a redacted `{ reason, nextAction }`
 * defined here, not as the raw response body.
 */

/** An artefact that reached Postman. */
export interface IPushedArtifact {
  /** `"created"` if new, `"updated"` if it replaced an existing one. */
  readonly action: "created" | "updated";
  /** UID assigned by Postman (`<userId>-<uuid>`). */
  readonly uid: string;
  readonly name: string;
}

/** Why the upload could not happen, and what to do. */
export interface IPushFailure {
  readonly reason: string;
  readonly nextAction: string;
}

/** The full result of a `push`. */
export interface IPushOutcome {
  readonly code: number;
  /**
   * Postman user the upload was authenticated as.
   *
   * Visible name only. This is what lets the reader realize they
   * uploaded to the wrong workspace — the costly error of this
   * command.
   */
  readonly user: string | null;
  /** `null` if no framework was recognized. */
  readonly framework: string | null;
  /** Number of requests uploaded. */
  readonly requests: number;
  /** The collection, or `null` if it never reached Postman. */
  readonly collection: IPushedArtifact | null;
  /** One entry per uploaded environment. Empty with `--no-environments`. */
  readonly environments: ReadonlyArray<IPushedArtifact>;
  /** `null` on success. */
  readonly error: IPushFailure | null;
}
