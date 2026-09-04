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
   * Los subdirectorios del workspace, relativos a `projectRoot`, en
   * formato POSIX y sin `..`. Vacío cuando no es monorepo o cuando los
   * globs no resuelven a ningún directorio existente.
   */
  readonly workspaceDirs: ReadonlyArray<string>;
  /**
   * Recomendación cuando hay **exactamente un** workspace. `null` en
   * cualquier otro caso (no-monorepo, cero workspaces o varios). El
   * orquestador pega este valor en `match.frameworkSearchRoot` solo
   * si la persona no pasó `--framework-search-root`.
   */
  readonly frameworkSearchRoot: string | null;
}

/** Resultado completo del pipeline. */
export interface IGenerationResult {
  readonly collection: PostmanCollection;
  readonly specs: ReadonlyArray<EndpointSpec>;
  readonly routes: ReadonlyArray<ParsedRoute>;
  readonly config: ProjectConfig;
  readonly match: IProjectMatch | null;
  /**
   * Identidad estable del servicio que produjo este resultado
   * (derivada de `match.frameworkSearchRoot`).
   *
   * Se introdujo en x00024 para que el branch multi-servicio de
   * `generateCollection()` (singular) pueda construir el error
   * `MultipleServicesWithoutCombineError` con los ids de los
   * servicios detectados, en vez de descartar N-1 silenciosamente.
   * Single-service también lo trae (es la identidad del único
   * servicio: `"default"` o el frameworkSearchRoot derivado).
   */
  readonly serviceId?: string;
  /** `"scanner"` si lo resolvió un scanner del registry; `"legacy"` si no. */
  readonly origin: "scanner" | "legacy";
  /** Flujo de sesión cableado, o `null` si el proyecto no expone login. */
  readonly authFlow: IAuthFlow | null;
  /**
   * Esquema de autenticación detectado, con su evidencia.
   *
   * Se expone para que los exportadores a otros formatos no lo deduzcan
   * cada uno por su cuenta: cinco detecciones paralelas acabarían
   * discrepando, y el mismo proyecto diría bearer en Postman y nada en
   * Insomnia.
   */
  readonly authScheme: IDetectedAuthScheme;
  /** Contexto resuelto del proyecto. */
  readonly context: IProjectContext;
  /**
   * Avisos para la persona que ejecuta esto. No son errores: la
   * colección se ha generado igual. Son las cosas que, de no decirse,
   * dejan a alguien con una colección a la que le falta media API sin que
   * lo sepa.
   */
  readonly warnings: ReadonlyArray<string>;
  /** Todos los frameworks que reconocieron el proyecto, no solo el ganador. */
  readonly frameworks: ReadonlyArray<string>;
  /**
   * De dónde salió la configuración.
   *
   * Lo necesita `summary` para decir si el proyecto trae config propia o
   * va en zero-config.
   */
  readonly project: {
    readonly zeroConfig: boolean;
    readonly configPath: string;
    readonly manualEndpoints: number;
  };
  readonly metrics: IGenerationMetrics;
  /**
   * Provenance por endpoint, cuando la detección fue híbrida
   * (2+ frameworks). Cada entrada dice de qué scanner vino cada
   * pieza del endpoint (ruta, body, auth, descripción).
   *
   * Es `undefined` cuando solo un scanner reconoció el proyecto:
   * no hay nada que reconciliar y el `provenance` sería trivial
   * (un solo contributor).
   *
   * Los campos de los `EndpointSpec` resultantes son los que ganó la
   * comparación, no los del scanner que más rutas aportó: en un
   * híbrido, OpenAPI puede tener la ruta y Fastify el body, y el
   * spec fusionado lleva el body de Fastify con la provenance de
   * ambos.
   */
  readonly provenance?: ReadonlyArray<IEndpointProvenanceEntry>;
}

/** La configuración del proyecto, ya resuelta, y de dónde ha salido. */
export interface LoadedProject {
  config: ProjectConfig;
  manualEndpoints: EndpointSpec[];
  /**
   * Importa tanto como el config: es la diferencia entre «no encontré tu
   * fichero» y «lo encontré y dice esto», que es lo primero que hay que
   * saber cuando la salida no es la esperada.
   */
  configPath: string;
  endpointsPath: string | null;
  /** True si se generó un ProjectConfig zero-config (sin archivo host). */
  zeroConfig: boolean;
}

/** Entradas de las que se puede derivar el contexto de un proyecto. */
export interface IResolveContextOptions {
  /** Raíz del proyecto. Si falta, se deduce de `argv` o `env`. */
  readonly projectRoot?: string | undefined;
  /** Directorio de salida. Si falta, el convencional del proyecto. */
  readonly outputDir?: string | undefined;
  /** `process.argv` inyectable, para poder testear sin tocar el global. */
  readonly argv?: ReadonlyArray<string>;
  /** `process.env` inyectable, por el mismo motivo. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Qué rutas fijar durante una sección con rutas propias. */
export interface IPathScope {
  readonly projectRoot?: string;
  readonly outputDir?: string;
}

/** Lo que sale de adaptar las rutas de un scanner al catálogo del núcleo. */
export interface AdapterResult {
  readonly specs: EndpointSpec[];
  readonly routes: ReadonlyArray<ParsedRoute>;
  /**
   * Los contadores de con y sin reglas: la medida de cuánto se ha podido
   * deducir del código frente a cuánto se ha inferido.
   */
  readonly withFormRequest: number;
  readonly withoutFormRequest: number;
  /**
   * Endpoints cuyo proveedor de validación **falló**.
   *
   * No es lo mismo que «sin reglas», y confundirlos era el problema: un
   * proveedor que lanza dejaba el endpoint exactamente igual que uno que
   * legítimamente no tiene validación, así que un parser roto degradaba
   * la colección entera sin que nadie lo notara. Lo único que cambiaba
   * era un contador que nadie miraba.
   */
  readonly validationFailures: ReadonlyArray<string>;
}
