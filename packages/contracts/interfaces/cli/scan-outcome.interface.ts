/**
 * What scanning a project returns: the discovery verdict.
 *
 * Lives here, not inside `scan.script.ts`, because two worlds that
 * should not know each other consume it: the command that produces
 * it and the MCP tool that exposes it. With the type glued to the
 * script, the plugin had to import the whole command — with its
 * scanner registry behind — just to know the shape of the data.
 *
 * This is the step **before** `IProjectSummary`: this is what
 * discovery sees raw, that is the project already interpreted.
 * When the two numbers don't line up, the difference is exactly in
 * the middle.
 */

/** A route discovered by the scanner, before becoming a request. */
export interface IScannedRoute {
  readonly method: string;
  readonly uri: string;
  readonly tags: ReadonlyArray<string>;
  /** `null` when the framework provides no description for this route. */
  readonly description: string | null;
}

/** The full result of a scan. */
export interface IScanOutcome {
  readonly code: number;
  /** The root that ended up being scanned, already resolved. */
  readonly root: string;
  /** `null` if no framework was recognized. */
  readonly framework: string | null;
  /**
   * The files that gave the framework away: `package.json`,
   * `server.js`...
   *
   * This is the "why" of the detection. Without them, a
   * misdetected framework is indistinguishable from a correctly
   * detected one.
   */
  readonly artifacts: ReadonlyArray<string>;
  /** Name of the class that walks the routes, or `null` if none. */
  readonly scanner: string | null;
  /** Name of the validation-rules provider, or `null`. */
  readonly validation: string | null;
  readonly routes: ReadonlyArray<IScannedRoute>;
}
