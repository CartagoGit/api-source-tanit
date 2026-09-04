/**
 * Framework-agnostic contracts for discovery and validation.
 *
 * The `api-source-tanit` package produces Postman v2.1.0 collections
 * regardless of the host project's framework. To support Laravel,
 * Symfony, Slim, Express, FastAPI, OpenAPI-3, etc. without rewriting
 * the orchestrator, all input parsing goes through three
 * interfaces:
 *
 *   - `IProjectScanner` — describes HOW the project is discovered
 *     (which files exist, which framework it is).
 *   - `IRouteScanner` — extracts routes (method+uri) in a neutral
 *     shape.
 *   - `IValidationSpecProvider` — resolves a route to
 *     `IValidationSpec` (field rules) if the framework defines them.
 *
 * Each `IRouteScanner` and `IValidationSpecProvider` is associated
 * with a `framework id` (e.g. `"laravel"`, `"openapi"`).
 * `discoverProject()` runs every registered `IRouteScanner` and keeps
 * the first one whose `detect()` (forward/declarative matcher)
 * signals a positive match.
 *
 * The `ParsedRoute` shape is designed to be 1-1 translatable to
 * `EndpointSpec` (URI already normalized to Postman `{{x}}`).
 *
 * @see ./postman.interface.ts for the Postman v2.1.0 types.
 */

import type { IEndpointAuth } from "./postman.interface.js";

/** Stable framework id. Used as a key in config. */
export type FrameworkId = "laravel" | "openapi" | "express" | "fastapi" | "symfony" | string;

/** Result of the initial sniffing. */
export interface IProjectMatch {
  /** Framework id (slugged, kebab-case). */
  readonly framework: FrameworkId;
  /** Version reported by the manifest (composer.json version, etc.). */
  readonly version?: string;
  /** Resolved project root. */
  readonly projectRoot: string;
  /**
   * Subdirectory where the framework lives, **relative** to
   * `projectRoot`. Useful in monorepos (`apps/web`, `packages/api`,
   * `services/orders`) where the root manifest is not the
   * framework's.
   *
   * The host (CLI/MCP) computes it after detecting the monorepo and
   * passes it to the scanner through this field. If absent, scanners
   * look at the root. **It is never** concatenated with
   * `process.cwd()` and never absolute: the root is always
   * `projectRoot` and this field only adds one segment, exactly like
   * `--framework-search-root` in the CLI.
   *
   * Added in f00011 S1. The monorepo detection itself (turbo.json,
   * `package.json#workspaces`, ...) lives in the orchestrator and
   * stays out of the scanner contract: this field is the result, not
   * the method.
   */
  readonly frameworkSearchRoot?: string;
  /** Paths of relevant extra artefacts (composer.json, openapi.yaml...). */
  readonly artifacts: ReadonlyArray<string>;
}

/**
 * Declarative detector: does this scanner know how to handle this
 * project?
 *
 * `detect()` returns `{ score, evidence }` so the UI can show **why**
 * a framework was chosen, not just which one. Each scanner annotates
 * each signal it saw and the exact score delta; the collection gets
 * painted in `summary` and in the UI.
 */
export interface IProjectScanner {
  readonly framework: FrameworkId;
  /**
   * Confidence score (0-1), plus the signals that motivated the
   * score. If score=0, evidence is ignored and the scanner is not
   * tried.
   */
  detect(projectRoot: string): Promise<IProjectScannerResult>;
  /** Builds the final IProjectMatch. Called only if detect > 0. */
  resolve(projectRoot: string): Promise<IProjectMatch>;
}

/** What `IProjectScanner.detect` returns. */
export interface IProjectScannerResult {
  /** Score 0-1. If 0, the orchestrator discards it. */
  readonly score: number;
  /** The signals that raised the score. */
  readonly evidence: ReadonlyArray<IProjectDetectionEvidence>;
}

/** A single detection signal, surfaced through the UI. */
export interface IProjectDetectionEvidence {
  /** What the detector saw, in one human-readable line. */
  readonly signal: string;
  /** Score bump contributed by this signal. */
  readonly weight: number;
  /** File the signal was read from (relative to projectRoot). */
  readonly artifact?: string;
}

/** Route in neutral format. Transformed into EndpointSpec at the end. */
export interface ParsedRoute {
  /**
   * Which scanner produced this route.
   *
   * Without this field, a route couldn't say who produced it, and the
   * OpenAPI scanner invented a hidden property (`__params`) smuggled
   * in with `as any` to recognise its own routes in a hybrid project
   * — where `match.framework` is the dominant framework, not the
   * one for each route.
   *
   * It is optional because the pipeline fills it in when collecting
   * what each scanner returns: forcing all twenty-one scanners to
   * repeat their own id on every route would be asking them to
   * remember something the registry already knows.
   */
  framework?: FrameworkId;
  /** HTTP method in UPPERCASE. */
  method: string;
  /** Full URI resolved with prefixes. WITHOUT `api/` if the scanner already applied it. */
  uri: string;
  /** URI without prefixes (the one the dev put in `Route::get('...')`). */
  rawUri: string;
  /** Origin: routes file or spec name (e.g. "openapi.yaml#/paths/~1users"). */
  sourceFile: string;
  /** 1-based line number in `sourceFile` (0 if not applicable). */
  lineNumber: number;
  /** Chain of prefixes active when declaring the route. */
  prefixChain: string[];
  /** FQCN of the controller if it could be resolved (e.g. `App\Http\…`). */
  controllerClass?: string;
  /** Name of the controller method (e.g. `index`). */
  actionName?: string;
  /** Human-readable endpoint name (auto-derived if not given). */
  displayName?: string;
  /** Tags / semantic groups (e.g. OpenAPI tags). */
  tags?: ReadonlyArray<string>;
  /**
   * Exact request body, when the scanner knows it.
   *
   * Usually it does not: from a `POST /users` we extract the
   * **validation rules** and build the example from them. But there
   * are protocols where the body is not a set of fields but a
   * concrete document — the GraphQL query is the case — and
   * breaking it into fields to reassemble it would ruin it.
   *
   * If present, it wins over what the adapter infers.
   */
  body?: unknown;
  /** Free description of the endpoint (OpenAPI summary, docstring, etc.). */
  description?: string;  /**
   * Auth override declared by the scanner for THIS route.
   *
   * Audit 2nd review #17: without this field, scanners cannot declare
   * "this endpoint is public" / "uses apiKey" from their neutral
   * contract. Only what the adapter already knew (`body`, `fields`)
   * survived; auth had to come from the pipeline's global heuristic.
   * Now, if a scanner detects that a specific route breaks the
   * framework convention (e.g. a login route in a project with global
   * bearer), it can declare the override here and the merger
   * respects it.
   */
  auth?: IEndpointAuth;}

/**
 * What `IRouteScanner.scan()` returns.
 *
 * Before, scanners stored in an instance `Map` the schemas /
 * validators / structs they found: two invocations on the same
 * scanner contaminated the result, and that caused real bugs (fixed
 * in a00010 S2). The honest shape is that the state **lives in the
 * output of `scan()`** and is discarded when the call ends — if the
 * next one needs the data again, it recomputes it.
 *
 * `routes` are the routes in neutral format. The auxiliary maps are
 * **optional and type-agnostic**: each scanner fills them in however
 * it can, and only its own provider consumes them in the same call.
 * An empty map means "this scanner did not collect any auxiliary";
 * `undefined` means "not applicable to this framework".
 *
 * The open shape (`schemas` as `Map<string, string>`, `validators`
 * and `structs` as `Map<string, I…Descriptor>`) comes from the four
 * frameworks having different dialects: Fastify carries the JSON
 * Schema inside the route itself, Hono mounts the validator with
 * `zValidator(...)` and needs to know which file holds the zod
 * schema, Fiber and Rust read the body with `BodyParser` /
 * `web::Json<T>` and have to open the struct declared elsewhere.
 * Throwing it all into a single `Map<string, string>` would force
 * duplicating the descriptor inside the serialized string.
 */
export interface IScanResult {
  readonly routes: ReadonlyArray<ParsedRoute>;
  /**
   * Map `${method} ${uri}` → auxiliary descriptor.
   *
   * Used by `FastifyRouteScanner` to store the JSON Schema declared
   * on the route itself. Other frameworks leave it `undefined`.
   */
  readonly schemas?: ReadonlyMap<string, string>;
  /**
   * Validator descriptors, indexed by `${method} ${uri}`.
   *
   * Only `HonoRouteScanner` fills it in: the name of the zod schema
   * used by `zValidator(...)`, plus the file where it is declared
   * (typically a different file).
   */
  readonly validators?: ReadonlyMap<string, IValidatorDescriptor>;
  /**
   * The structs that parse the body in Go/Rust, indexed the same way.
   *
   * Used by `FiberRouteScanner` and `RustRouteScanner`: the struct
   * pointed to by `BodyParser` / `web::Json<T>`, plus the file where
   * it is declared.
   */
  readonly structs?: ReadonlyMap<string, IStructDescriptor>;
  /**
   * Non-fatal errors found during the scan: files that a third-party
   * parser couldn't process but that don't abort the scan.
   *
   * Filled in by `ExpressRouteScanner` from `parseModule` in the
   * TypeScript frontend: a file with invalid syntax comes back as
   * `null` in the AST and leaves the reason here, so it doesn't
   * disappear without a trace.
   */
  readonly diagnostics?: ReadonlyArray<IParseDiagnostic>;
}

/**
 * A non-fatal parse problem: the file could not be processed, but
 * the scan continues.
 *
 * Lives in this package (not in the frontend one) so scanners in any
 * language can reuse it — the shape is agnostic.
 */
export interface IParseDiagnostic {
  /** File that could not be processed (as passed to the parser). */
  readonly file: string;
  readonly severity: "error" | "warning";
  /** Human-readable reason: the parser message, no stack. */
  readonly reason: string;
}

/**
 * What Hono associates with a route: schema name + file path where
 * it is declared.
 *
 * The name stays only for error messages; the fields are read by
 * parsing the `z.object({…})` that lives in `file`.
 */
export interface IValidatorDescriptor {
  readonly name: string;
  readonly file: string;
}

/** What Fiber and Rust associate with a route: the struct that parses the body. */
export interface IStructDescriptor {
  readonly name: string;
  readonly file: string;
}

/**
 * Route scanned from the host project. */
export interface IRouteScanner {
  readonly framework: FrameworkId;
  /** Matches with IProjectScanner.framework. */
  matches(match: IProjectMatch): boolean;
  /**
   * Returns the routes and auxiliary artefacts in a single object.
   *
   * The result **is not reused across calls**: each scanner is
   * stateless with respect to previous invocations, and any `Map`
   * it needs lives inside this method and is discarded on return.
   * Before, the four scanners affected by a00010 B-06 stored those
   * `Map`s as `private readonly`, and two consecutive scans shared
   * the result.
   */
  scan(match: IProjectMatch): Promise<IScanResult>;
}

/** Validation specification of a parameter (agnostic). */
export interface IValidationSpec {
  /** Field name (the key in body / query / path). */
  fieldName: string;
  /** 'body' | 'query' | 'path' | 'header' | 'cookie'. */
  location: "body" | "query" | "path" | "header" | "cookie";
  /** Logical type. */
  type:
    | "string"
    | "integer"
    | "number"
    | "boolean"
    | "array"
    | "object"
    | "date"
    | "datetime"
    | "file"
    | "enum"
    | "any";
  /** Is it required? */
  required: boolean;
  /** If type === 'enum', allowed values. */
  enumValues?: ReadonlyArray<string>;
  /** Semantic format (email, uuid, url, ipv4…). */
  format?: string;
  /** Length cap (string) or cardinality cap (array). */
  maxLength?: number;
  /** Length floor. */
  minLength?: number;
  /** Minimum value (number/date). */
  minimum?: number;
  /** Maximum value (number/date). */
  maximum?: number;
  /** Regex pattern declared by the framework. */
  pattern?: string;
  /** Free description (from the docstring / schema). */
  description?: string;
  /** Example declared by the framework. */
  example?: unknown;
}

/** Validation specification for a specific endpoint. */
export interface IEndpointValidation {
  /** Endpoint it applies to (normalized method+uri key). */
  readonly endpointKey: string;
  /** Rules per location. */
  readonly fields: ReadonlyArray<IValidationSpec>;
}

/** Provider of ValidationSpec for a framework. */
export interface IValidationSpecProvider {
  readonly framework: FrameworkId;
  /**
   * Does it have validation specs for this endpoint?
   *
   * `scanResult` is what `IRouteScanner.scan()` just returned for
   * the same `match`. Providers that don't need auxiliaries (the
   * sixteen that are NOT Fastify/Hono/Fiber/Rust) ignore it.
   */
  supports(
    route: ParsedRoute,
    match: IProjectMatch,
    scanResult: IScanResult,
  ): Promise<boolean>;
  /**
   * Resolves the fields.
   *
   * The contract requires `scanResult` even though most providers
   * ignore it: that way the four that need it (Fastify, Hono,
   * Fiber, Rust) read their maps straight from the scanner output,
   * without depending on hidden state. This is what closed a00010
   * S2 — before they shared a scanner instance with a mutable
   * `Map`, and two consecutive scans contaminated each other.
   */
  resolve(
    route: ParsedRoute,
    match: IProjectMatch,
    scanResult: IScanResult,
  ): Promise<IEndpointValidation>;
}

/**
 * A framework that recognised the project, with its collaborators.
 *
 * Lives here —not in `discovery.interface.ts`— because
 * `IDiscoveryOrchestrator` returns it and the orchestrator contract
 * lives here: alongside the scanners that produce the `evidence`,
 * not next to the pipeline that consumes it. Having two
 * declarations of the same type in different modules is a crack
 * where drift creeps in; TypeScript merges the interfaces, but the
 * conceptual contract stops being unique.
 */
export interface IDetectedFramework {
  readonly match: IProjectMatch;
  readonly scanner: IRouteScanner | null;
  readonly validation: IValidationSpecProvider | null;
  /** Detector confidence, from 0 to 1. */
  readonly score: number;
  /** The signals that motivated the score. */
  readonly evidence: ReadonlyArray<IProjectDetectionEvidence>;
}

/**
 * Main entry point: "given a projectRoot, give me the right scanner".
 *
 * `forceFramework` receives **a named object** with `projectRoot`
 * and `framework`. Before, the signature was `(framework,
 * projectRoot)` in the interface and `(projectRoot, framework)` in
 * the implementation — incompatible, but `string` and `string` sail
 * through TypeScript without complaint. An external implementer
 * perfectly conforming to the public contract would receive the
 * arguments swapped without any type error. The named object closes
 * the bug: the key, not the position, decides the role.
 */
export interface IDiscoveryOrchestrator {
  /** Everyone who recognises the project, ordered by confidence. */
  detectAll(projectRoot: string): Promise<IDetectedFramework[]>;
  /** Force a specific framework, skipping detection. */
  forceFramework(
    args: { projectRoot: string; framework: string },
  ): Promise<IDetectedFramework | null>;
  /** The identifiers this catalogue knows how to recognise. */
  supportedFrameworks(): string[];
}
