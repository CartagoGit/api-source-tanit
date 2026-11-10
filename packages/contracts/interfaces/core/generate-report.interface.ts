/**
 * Machine-readable report of a generation (`generate --json`).
 *
 * It exists because the delendai plugin needed to know which files had
 * been written and how many endpoints there were, and extracted that
 * with regular expressions over the CLI's human-readable text. That
 * broke silently as soon as the CLI was translated to English: the
 * plugin kept scanning that output for a success marker and returned
 * `collectionPath: null` without raising any error.
 *
 * With `--json` the contract is explicit and versioned, and the
 * human-readable text can change language, format, or order without
 * breaking anyone. In that mode the readable output goes to **stderr**
 * and `stdout` contains exactly one JSON document.
 *
 * @example
 * ```sh
 * apisrc generate --project-root ./my-api --json | jq .collectionPath
 * ```
 */

/**
 * Contract version. Bumps when the shape changes incompatibly.
 *
 * v2: adds `frameworks` and `warnings` (hybrid projects).
 */
export const GENERATE_REPORT_VERSION = 3;

/** What the detected login flow wired into the collection. */
export interface IGenerateReportAuth {
  /** The login endpoint, as `POST /auth/login`. */
  readonly loginEndpoint: string;
  /** Environment variable where the captured token is stored. */
  readonly tokenVariable: string;
}

/** Result of `generate --json`. */
export interface IGenerateReport {
  readonly version: number;
  /** `false` if generation finished with a non-zero exit code. */
  readonly ok: boolean;
  /** Detected framework, or `null` if none was recognized. */
  readonly framework: string | null;
  /**
   * All frameworks that recognized the project.
   *
   * More than one means a hybrid project: all have been scanned and
   * their endpoints merged.
   */
  readonly frameworks: ReadonlyArray<string>;
  /**
   * Warnings for whoever runs this. Not errors — the collection exists
   * anyway —, these are the things that, if left unsaid, leave someone
   * with an incomplete collection without knowing it.
   */
  readonly warnings: ReadonlyArray<string>;
  /** Absolute path of the scanned project root. */
  readonly projectRoot: string;
  /** Project name as it appears in the collection. */
  readonly projectName: string;
  /** Path of the written collection. `null` in `--inspect`. */
  readonly collectionPath: string | null;
  /** `_postman_id` of the collection: what identifies it when re-importing. */
  readonly collectionId: string | null;
  readonly environmentPaths: readonly string[];
  /**
   * Files written in formats other than Postman.
   *
   * Empty when none was requested. Kept apart from `environmentPaths`
   * because they are not environments: they are the same API in
   * another language (OpenAPI, Insomnia, Bruno, HAR, cURL).
   */
  readonly extraPaths: readonly string[];
  readonly requests: number;
  readonly folders: number;
  /** `null` if the project has no login endpoint. */
  readonly auth: IGenerateReportAuth | null;
  readonly durationMs: number;
}
