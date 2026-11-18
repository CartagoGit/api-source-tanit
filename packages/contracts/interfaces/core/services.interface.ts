/**
 * The services, as the app shows them.
 *
 * ## What the backend knows
 *
 * A service is a workspace of the project: its id, the framework
 * that recognized it, and how many operations it holds. That is what
 * `list-services` answers, and it is what the list draws.
 *
 * The app used to expect more — the transports, the base URL, the
 * auth reference, the list of operations — and the client filled the
 * gap by casting whatever came back. On a good day the extra fields
 * were `undefined` and the screen showed blank spaces; on a bad day
 * it showed a base URL that was never read.
 *
 * The operations are still available: the endpoint explorer has
 * them, and the app can group them by service. What is not available
 * is invented, so it is not here.
 */

/** One service of the project. */
export interface IServiceSummary {
  readonly serviceId: string;
  readonly framework: string;
  readonly endpointCount: number;
}

/** A service, with the operations the app already knows about. */
export interface IServiceDetail extends IServiceSummary {
  /** The transports its operations use, from the endpoint list. */
  readonly transports: ReadonlyArray<string>;
  /** How many of its operations the explorer shows. */
  readonly operationCount: number;
}
