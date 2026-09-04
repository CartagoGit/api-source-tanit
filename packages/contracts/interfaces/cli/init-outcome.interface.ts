/**
 * What preparing a project's configuration returns.
 *
 * `init` **writes inside the host project**, so what it returns has
 * to say exactly what was touched. An agent invoking it needs to
 * be able to show the two paths and what was detected, because
 * the next step is for someone to edit those files by hand: they
 * are filled with `// TODO` markers on purpose.
 */

/** The full result of an `init`. */
export interface IInitOutcome {
  readonly code: number;
  /** Name deduced from the ecosystem manifest. */
  readonly projectName: string;
  /** Base URL taken from `.env`, or the default. */
  readonly baseUrl: string;
  /**
   * Authentication guards detected in the middleware.
   *
   * `["token"]` when none is recognized: not that there is no auth,
   * but that no guard could be deduced.
   */
  readonly authGuards: ReadonlyArray<string>;
  /** Route files found, with the prefix that applies to them. */
  readonly routeFiles: ReadonlyArray<string>;
  /** Absolute path of the written `config.constant.ts`. */
  readonly configPath: string | null;
  /** Absolute path of the written `endpoints.constant.ts`. */
  readonly endpointsPath: string | null;
  /** Why it could not be done, and what to do. `null` on success. */
  readonly error: { readonly reason: string; readonly nextAction: string } | null;
}
