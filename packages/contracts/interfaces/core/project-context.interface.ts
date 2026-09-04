/**
 * Context of the project being scanned.
 *
 * Replaces the implicit resolution by the singleton retired from
 * `paths.service` (r00010 S2, 2026-09-03), which was computed **once
 * per process** from `POSTMAN_PROJECT_ROOT` or `--project-root`. That
 * worked for the CLI —one process per project— but:
 *
 *   - A long-lived consumer (the MCP server) that analyzed project A
 *     and then project B received A's routes for both.
 *   - It forced tests to mess with `process.env` and to reset the
 *     cache manually before each call.
 *   - It hid the dependency: `LaravelFormRequestValidationProvider`
 *     received `match.projectRoot` and still read the singleton, so
 *     without the environment variable it wouldn't resolve a single
 *     FormRequest.
 *
 * Passing the context explicitly makes the dependency visible in the
 * signature and the code reentrant without tricks.
 */

/** Resolved paths of a host project. */
export interface IProjectContext {
  /** Absolute root of the scanned project. */
  readonly projectRoot: string;
  /** Absolute root of the api-source-tanit package. */
  readonly packageRoot: string;
  /** Short name of the project, used to name the artefacts. */
  readonly projectBasename: string;
  /** Directory where the artefacts are written. */
  readonly outputDir: string;
}

/** Conventional subdirectories, derived from the root. */
export interface IProjectDirs {
  /**
   * `<root>/routes` — only used by legacy Laravel discovery.
   * A modern scanner receives the `projectRoot` and looks for its
   * own artefacts; these three fields disappear when that path is
   * retired.
   */
  readonly routes: string;
  /** `<root>/app` — same, only for the legacy path. */
  readonly app: string;
  /** `<root>/app/Http/Requests` — same, only for the legacy path. */
  readonly requests: string;
}
