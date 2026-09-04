/**
 * What the domain produces and consumes: options and results.
 *
 * The data shapes of the services that build the collection, talk to
 * the Postman API, or watch the project live here. None of them carry
 * code: they are what a consumer needs to declare what it receives
 * without dragging in the service that provides it.
 *
 * `IProjectSummary` is the case that motivated this whole section. The
 * web UI imported it from `core/discovery/summary.service`, meaning
 * that to type a summary it pulled the whole pipeline along with it.
 */

/**
 * What the host can declare to help wire up the session.
 *
 * Both fields are **last resort**, not expected configuration: the
 * flow detects the login by method and URI, and the token by trying
 * the usual response paths at runtime. Previously the token path had
 * to be declared, and the result was that auth did not activate in
 * any of the eleven example projects.
 */
export interface IApplyAuthFlowOptions {
  /**
   * Path declared by the host (`config.tokenResponsePath`). When
   * present it is the only one tried; otherwise the usual candidates
   * are tried.
   */
  readonly tokenResponsePath?: string | undefined;
  /**
   * Exact name of the login endpoint declared by the host. Only used
   * as a last resort, if URI-based detection finds nothing.
   */
  readonly loginEndpointName?: string | undefined;
}

/** Definition of an environment (project-agnostic). */
export interface EnvironmentDef {
  /** Name shown to the user in Postman. */
  name: string;
  /** Optional color in `#RRGGBB` format. */
  color?: string;
  /** Key → value map that OVERRIDES the base variables. */
  overrides?: Record<string, string>;
}

/** The body inferred for an endpoint and the confidence behind it. */
export interface BodyInference {
  /** Filename or heuristic that produced the body. */
  reason: string;
  body: Record<string, unknown>;
}

/**
 * How much the project-agnostic inference filled in.
 *
 * The CLI prints this: it is the way to see at a glance how much
 * comes from the code and how much from a heuristic.
 */
export interface InferApplyStats {
  bodiesAdded: number;
  queriesAdded: number;
  variableInferred: number;
  skippedManual: number;
}

/** Postman environment, as emitted by `environment-builder`. */
export interface IPostmanEnvironmentPayload {
  readonly id?: string;
  readonly name: string;
  readonly values: ReadonlyArray<Record<string, unknown>>;
}

/** Result of uploading an artifact. */
export interface IPushResult {
  /** `"created"` if it did not exist, `"updated"` if it was overwritten. */
  readonly action: "created" | "updated";
  /** UID assigned by Postman (`<userId>-<uuid>`). */
  readonly uid: string;
  readonly name: string;
}

/** Common options for all calls. */
export interface IPostmanApiOptions {
  readonly apiKey: string;
  /** Target workspace. If missing, falls back to the default personal workspace. */
  readonly workspaceId?: string | undefined;
  /** Injectable so tests can run without the network. */
  readonly fetchImpl?: typeof fetch;
}

/** What to watch, with how much debounce, and what to do when something changes. */
export interface IWatchOptions {
  /** Root of the project to watch. */
  readonly root: string;
  /** Milliseconds to wait after the last change. */
  readonly debounceMs?: number;
  /** Extra directories to ignore, on top of the default ones. */
  readonly ignoreDirs?: ReadonlySet<string>;
  /** What to do when a batch of changes settles. */
  readonly onChange: (changed: readonly string[]) => void | Promise<void>;
}

/** What `watchProject` returns so the watcher can be stopped. */
export interface IWatchHandle {
  close(): void;
}

/** What the parsing of `--format` returns. */
export type IParsedFormats =
  | { readonly ok: true; readonly formats: string[] }
  | { readonly ok: false; readonly invalid: string[]; readonly valid: string[] };

/**
 * Documentation health of a project, in percentages.
 *
 * Each field is `0..100` (integer, rounded) and answers "out of how
 * many endpoints will the collection carry this piece?". They are
 * the FEAT-003 signal: with them, a user sees at a glance whether
 * the API is well documented **before** generating the collection,
 * without opening Postman to count by hand.
 */
export interface IProjectHealth {
  /** % of endpoints whose validation rules were resolved. */
  readonly withValidationPercent: number;
  /** % of endpoints with an example body (rules resolved or inferred). */
  readonly withBodySchemaPercent: number;
  /** % of endpoints that carry at least one example value. */
  readonly withExamplesPercent: number;
  /** % of endpoints with a description. */
  readonly withDescriptionPercent: number;
}

/** Summary of a host project for quick inspection. */
export interface IProjectSummary {
  /** Detected framework. `"unknown"` if none was recognised. */
  framework: string;
  /**
   * All frameworks that recognised the project.
   *
   * More than one means a hybrid project, and in that case `framework`
   * is just the one with the highest confidence.
   */
  frameworks: ReadonlyArray<string>;
  /** Project name, from the ecosystem manifest. */
  projectName: string;
  /** Effective BaseUrl. */
  baseUrl: string;
  /**
   * Endpoints that will end up in the collection.
   *
   * Not "routes declared in code": a Laravel `apiResource` is one
   * line but seven endpoints, and what matters is the second number.
   */
  routesInCode: number;
  /** Endpoints whose validation rules were resolved. */
  withFormRequest: number;
  /** Endpoints without rules: their body comes from the project-agnostic inference. */
  withoutFormRequest: number;
  /** Bodies auto-filled by the project-agnostic heuristic. */
  bodiesAdded: number;
  /** Queries auto-filled by the project-agnostic heuristic. */
  queriesAdded: number;
  /** "zero-config" mode (no `config.constant.ts` was found). */
  zeroConfig: boolean;
  /** Path to the loaded `config.constant.ts`, or `"<zero-config>"`. */
  configPath: string;
  /** Endpoints defined manually as an override. */
  manualEndpoints: number;
  /** Collection variables derived from the routes. */
  inferredVariables: number;
  /** `null` if the project does not expose a login endpoint. */
  auth: { readonly loginEndpoint: string } | null;
  /** Actionable warnings: hybrid project, nothing recognised… */
  warnings: ReadonlyArray<string>;
  /**
   * The signals that motivated the framework choice.
   *
   * Each entry is something the detector saw and the exact score
   * bump it produced. The CLI prints them under `Why ${framework}?`;
   * the MCP tool exposes them in `summary.evidence`; the UI renders
   * them as icon-bearing cards. They are what turns
   * "framework: express (0.9)" into "because `package.json` lists
   * express in deps".
   *
   * Empty if the detector has not yet been enriched (most cases today).
   */
  evidence: ReadonlyArray<import("./scanner.interface.js").IProjectDetectionEvidence>;
  /**
   * Documentation health, in percentages `0..100`.
   *
   * Computed over the final specs —the same ones that feed the
   * collection—, so what it says is what `generate` produces. With
   * zero endpoints, every percentage is `0`.
   */
  health: IProjectHealth;
}
