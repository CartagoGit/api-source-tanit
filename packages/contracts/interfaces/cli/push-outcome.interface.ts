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
import type { EndpointSpec } from "../core/endpoint-legacy.interface.js";
import type { ProjectConfig } from "../core/project-config.interface.js";
import type { PostmanCollection } from "../core/postman.interface.js";
import type { IPostmanApiOptions } from "../core/domain.interface.js";

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

/**
 * What an upload did, without the parts that only the CLI prints.
 *
 * It lives here, and not next to the service that produces it, because
 * two packages consume it: the CLI's `push` command and the
 * Application API's `push` handler. A type that only the core knew
 * would have to be re-declared by the app to read the answer.
 */
export interface IPushArtifactsResult {
  /** The Postman account the key belongs to. */
  readonly user: string | null;
  /** The collection that reached Postman, if it did. */
  readonly collection: IPushedArtifact | null;
  /** The environments that reached Postman. */
  readonly environments: ReadonlyArray<IPushedArtifact>;
  /** `null` when everything went well. */
  readonly error: IPushFailure | null;
}

/**
 * Everything an upload needs.
 *
 * It is an object and not five positional arguments because two of
 * them are optional and mean different things:
 *
 *   · `verifiedUser` — when the caller already signed in. The CLI
 *     does, **before** scanning the project: a key that does not work
 *     should fail before the project is read and its files written.
 *   · `onApiError` — the raw error, for the human's trace. The
 *     Postman response body can carry the request, and with it the
 *     key, so it never travels back in the answer; but the person who
 *     ran the command should be able to read it.
 */
export interface IPushArtifactsRequest {
  readonly collection: PostmanCollection;
  readonly specs: ReadonlyArray<EndpointSpec>;
  readonly config: ProjectConfig;
  readonly options: IPostmanApiOptions;
  readonly withEnvironments: boolean;
  /** The account, when the caller already signed in. */
  readonly verifiedUser?: string | undefined;
  /** Called with the raw error, for the human's trace. */
  readonly onApiError?: ((error: unknown) => void) | undefined;
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
