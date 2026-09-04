/**
 * Discovery: who recognizes a project, and what comes out of scanning it.
 *
 * Everything here is **data shapes**, no executable line. That is
 * what lets the MCP plugin or the web UI declare the pipeline's
 * output without importing the pipeline — which drags the 21
 * scanners behind — which is exactly what they used to do.
 */

import type {
  IDiscoveryOrchestrator,
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpecProvider,
  ParsedRoute,
} from "./scanner.interface.js";
import type {
  EndpointSpec,
  PostmanCollection,
  PostmanItem,
} from "./postman.interface.js";
import type { ProjectConfig } from "./project-config.interface.js";
import type { IProjectContext } from "./project-context.interface.js";
import type { ILegacyDiscovery } from "./legacy-discovery.interface.js";
import type { IEndpointProvenanceEntry } from "./merge.interface.js";

/** Catalog of detectors, scanners, and validation providers. */
export interface DiscoveryRegistry {
  readonly detectors: ReadonlyArray<IProjectScanner>;
  readonly routeScanners: ReadonlyArray<IRouteScanner>;
  readonly validationProviders: ReadonlyArray<IValidationSpecProvider>;
}

/** Discovery metrics, for reports and tests. */
export interface IGenerationMetrics {
  readonly routes: number;
  readonly specs: number;
  readonly withValidation: number;
  readonly withoutValidation: number;
  readonly bodiesInferred: number;
  readonly queriesInferred: number;
}

/** Authentication forms the scanner can recognize. */
export type AuthSchemeType = "bearer" | "apikey" | "oauth2" | "none";

/**
 * The detected authentication scheme, with the signal that gave it away.
 *
 * `evidence` is not decoration: an automatic detection that cannot be
 * cross-checked has to be trusted blindly.
 */
export interface IDetectedAuthScheme {
  readonly type: AuthSchemeType;
  /** Header or query-param name, only for `apikey`. */
  readonly keyName?: string;
  /** Where the key travels, only for `apikey`. */
  readonly keyIn?: "header" | "query";
  /** Token endpoint URL, only for `oauth2`. */
  readonly tokenUrl?: string;
  /** Authorization URL, only for `oauth2`. */
  readonly authorizeUrl?: string;
  /**
   * Why this was decided.
   *
   * Surfaces in the CLI warning and in the collection description: an
   * automatic detection that cannot be cross-checked has to be
   * trusted blindly.
   */
  readonly evidence: string;
}

/** The `auth` block as Postman expects it. */
export interface IPostmanAuth {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** The three steps of the session cycle, wired into the collection. */
export interface IAuthFlow {
  readonly login: PostmanItem | null;
  readonly refresh: PostmanItem | null;
  readonly logout: PostmanItem | null;
}

/** Optional pipeline settings. */
export interface IGenerationOptions {
  /** Overrides `config.collectionName` (flag `--basename`). */
  readonly collectionName?: string;
  /**
   * Framework catalog to use for detection and scanning.
   *
   * Intentionally required. The pipeline used to import
   * `defaultOrchestrator()` from the concrete registry, and that
   * pulled the scanners into core: `core` could not be compiled,
   * tested, or reasoned about without dragging Laravel, Gin, and
   * Spring Boot. A core that claims to be agnostic cannot have an
   * edge into anything concrete.
   */
  readonly orchestrator: IDiscoveryOrchestrator;
  /**
   * What to do when no scanner recognizes the project.
   *
   * Optional: with no fallback, an unrecognized project returns zero
   * endpoints — an honest answer.
   */
  readonly legacyFallback?: ILegacyDiscovery | undefined;
  /**
   * Framework to use, skipping detection.
   *
   * For when autodetection cannot guess: a monorepo whose manifest
   * is at the root, an aliased dependency, a generated-at-build
   * manifest.
   */
  readonly forceFramework?: string | undefined;
  /**
   * Subdirectory where the framework lives, **relative** to
   * `projectRoot`.
   *
   * Two ways to pass it:
   *
   *  - **Forced** (CLI `--framework-search-root`, plugin option):
   *    used literally, with no tree walk. Whoever knows their API
   *    and cannot wait for autodetection passes it this way.
   *  - **Auto**: if omitted and the root is a monorepo (turbo.json,
   *    pnpm-workspace.yaml, lerna.json, or `package.json#workspaces`)
   *    with exactly **one** workspace, the orchestrator fills it in
   *    itself. With several workspaces, it fills nothing: the
   *    choice between `apps/api`, `apps/web`, and `packages/auth`
   *    is made by whoever knows their repo.
   *
   * The resolved value lands in `IProjectMatch.frameworkSearchRoot`,
   * which is what the scanners already read (f00011 S1). Only the
   * pipeline entry is declared here; the assignment to `match`
   * lives in `generation.pipeline.ts`.
   *
   * **Never absolute**: the root is always `projectRoot` and this
   * field only adds one segment, exactly like
   * `--framework-search-root` in the CLI. Concatenating with
   * `process.cwd()` is forbidden by the universal no-globals-in-hot-path
   * gate.
   *
   * Added in f00011 S3 (2026-09-03). S1 left the field in
   * `IProjectMatch` with scanners reading it; S3 closes the host
   * side (CLI, config, and orchestrator).
   */
  readonly frameworkSearchRoot?: string | undefined;
  /**
   * `argv` passed by the pipeline to the loader (`loadProject`).
   * Empty by default: core does NOT read `process.argv` at
   * runtime — whoever invokes the pipeline (CLI, MCP plugin, web UI,
   * tests) decides what to pass.
   *
   * If missing, the loader treats the absence as "no `--config` flag",
   * which is what it did before when `argv` did not arrive. The CLI
   * passes `process.argv.slice(2)` from `cli.script.ts` (composition
   * root); the tests pass an empty array or whatever they need.
   *
   * a00012 S4.
   */
  readonly argv?: ReadonlyArray<string> | undefined;
  /**
   * Combine all services of a monorepo into a single collection.
   * Default `false`: the pipeline emits one collection per service.
   * Only applies to multi-service (a00013 S3); on flat projects it
   * is ignored.
   *
   * When `true`, `PipelineResult` is always `IGenerationResult`
   * (not an array). When `false` or absent and the detected
   * `services` count is > 1, returns `IGenerationResult[]`. A
   * single detected service always returns `IGenerationResult`
   * (legacy).
   *
   * The caller decides: the CLI passes this flag based on
   * `--combine-services`; the MCP plugin and the web UI pass an
   * equivalent UI option.
   */
  readonly combineServices?: boolean | undefined;
}

/**
 * Return shape of `detectMonorepo()`
 * (`packages/core/discovery/monorepo-detector.helper.ts`). f00011 S3.
 *
 * Lives here — not next to the helper — because it is a data shape
 * the pipeline and tests consume, and `lint:contracts` requires
 * shared types between implementations to live in `contracts/`. The
 * helper is **pure** and only used by `generation.pipeline.ts` and
 * `tests/core/monorepo-detector.spec.ts`.
 */
export interface IMonorepoDetection {
  /** Is there any standard monorepo signal at the root? */
  readonly isMonorepo: boolean;
  /**
   * The exact file read to conclude `isMonorepo`. `null` when there
   * is no monorepo: pipeline warnings can say "no monorepo detected"
   * without filtering which of the four was looked at first.
   */
  readonly signal: string | null;
  /**
   * The workspace subdirectories, relative to `projectRoot`, in POSIX
   * format and without `..`. Empty when it is not a monorepo or when
   * the globs resolve to no existing directory.
   */
  readonly workspaceDirs: ReadonlyArray<string>;
  /**
   * Recommendation when there is **exactly one** workspace. `null` in
   * any other case (not a monorepo, zero workspaces, or several). The
   * orchestrator pastes this value into `match.frameworkSearchRoot`
   * only if the caller did not pass `--framework-search-root`.
   */
  readonly frameworkSearchRoot: string | null;
}

/** Full pipeline result. */
export interface IGenerationResult {
  readonly collection: PostmanCollection;
  readonly specs: ReadonlyArray<EndpointSpec>;
  readonly routes: ReadonlyArray<ParsedRoute>;
  readonly config: ProjectConfig;
  readonly match: IProjectMatch | null;
  /**
   * Stable identity of the service that produced this result
   * (derived from `match.frameworkSearchRoot`).
   *
   * Introduced in x00024 so that the multi-service branch of
   * `generateCollection()` (singular) can build the
   * `MultipleServicesWithoutCombineError` with the ids of the detected
   * services, instead of silently dropping N-1. Single-service carries
   * it too (the identity of the single service: `"default"` or the
   * derived frameworkSearchRoot).
   */
  readonly serviceId?: string;
  /** `"scanner"` if a registry scanner resolved it; `"legacy"` otherwise. */
  readonly origin: "scanner" | "legacy";
  /** Wired-in session flow, or `null` if the project exposes no login. */
  readonly authFlow: IAuthFlow | null;
  /**
   * Detected authentication scheme, with its evidence.
   *
   * Exposed so that exporters to other formats do not each deduce it
   * on their own: five parallel detections would end up disagreeing,
   * and the same project would say bearer in Postman and nothing in
   * Insomnia.
   */
  readonly authScheme: IDetectedAuthScheme;
  /** Resolved project context. */
  readonly context: IProjectContext;
  /**
   * Warnings for whoever runs this. Not errors: the collection has
   * been generated anyway. These are the things that, if left unsaid,
   * leave someone with a collection missing half the API without
   * knowing it.
   */
  readonly warnings: ReadonlyArray<string>;
  /** All frameworks that recognized the project, not just the winner. */
  readonly frameworks: ReadonlyArray<string>;
  /**
   * Where the configuration came from.
   *
   * `summary` needs it to say whether the project brings its own
   * config or runs zero-config.
   */
  readonly project: {
    readonly zeroConfig: boolean;
    readonly configPath: string;
    readonly manualEndpoints: number;
  };
  readonly metrics: IGenerationMetrics;
  /**
   * Per-endpoint provenance, when detection was hybrid (2+ frameworks).
   * Each entry says which scanner contributed each piece of the
   * endpoint (path, body, auth, description).
   *
   * `undefined` when only one scanner recognized the project: there is
   * nothing to reconcile and `provenance` would be trivial (a single
   * contributor).
   *
   * The fields of the resulting `EndpointSpec`s are those that won the
   * comparison, not those of the scanner that contributed the most
   * routes: in a hybrid, OpenAPI may have the path and Fastify the
   * body, and the merged spec carries Fastify's body with the
   * provenance of both.
   */
  readonly provenance?: ReadonlyArray<IEndpointProvenanceEntry>;
}

/** The project's configuration, resolved, and where it came from. */
export interface LoadedProject {
  config: ProjectConfig;
  manualEndpoints: EndpointSpec[];
  /**
   * Matters as much as the config itself: it is the difference between
   * "I could not find your file" and "I found it and it says this" —
   * which is the first thing to know when the output is not what you
   * expected.
   */
  configPath: string;
  endpointsPath: string | null;
  /** True when a zero-config ProjectConfig was generated (no host file). */
  zeroConfig: boolean;
}

/** Inputs from which a project's context can be derived. */
export interface IResolveContextOptions {
  /** Project root. If missing, derived from `argv` or `env`. */
  readonly projectRoot?: string | undefined;
  /** Output directory. If missing, the project's conventional one. */
  readonly outputDir?: string | undefined;
  /** Injectable `process.argv`, to test without touching the global. */
  readonly argv?: ReadonlyArray<string>;
  /** Injectable `process.env`, for the same reason. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Which paths to fix during a section with its own paths. */
export interface IPathScope {
  readonly projectRoot?: string;
  readonly outputDir?: string;
}

/** What comes out of adapting a scanner's paths to core's catalog. */
export interface AdapterResult {
  readonly specs: EndpointSpec[];
  readonly routes: ReadonlyArray<ParsedRoute>;
  /**
   * The with-rules and without-rules counters: how much was deduced
   * from the code versus how much had to be inferred.
   */
  readonly withFormRequest: number;
  readonly withoutFormRequest: number;
  /**
   * Endpoints whose validation provider **failed**.
   *
   * This is not the same as "no rules", and confusing the two was the
   * problem: a throwing provider left the endpoint looking exactly like
   * one that legitimately had no validation, so a broken parser would
   * quietly degrade the whole collection. The only thing that changed
   * was a counter nobody watched.
   */
  readonly validationFailures: ReadonlyArray<string>;
}
