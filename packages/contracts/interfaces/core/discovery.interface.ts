/**
 * El descubrimiento: quién reconoce un proyecto y qué sale de escanearlo.
 *
 * Todo lo de aquí son **formas de dato**, sin una línea ejecutable. Es lo
 * que permite que el plugin MCP o la interfaz web declaren la salida del
 * pipeline sin importar el pipeline —que arrastra los 21 scanners
 * detrás—, que es exactamente lo que hacían antes.
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

/** El catálogo de detectores, scanners y proveedores de validación. */
export interface DiscoveryRegistry {
  readonly detectors: ReadonlyArray<IProjectScanner>;
  readonly routeScanners: ReadonlyArray<IRouteScanner>;
  readonly validationProviders: ReadonlyArray<IValidationSpecProvider>;
}

/** Métricas del descubrimiento, para informes y tests. */
export interface IGenerationMetrics {
  readonly routes: number;
  readonly specs: number;
  readonly withValidation: number;
  readonly withoutValidation: number;
  readonly bodiesInferred: number;
  readonly queriesInferred: number;
}

/** Las formas de autenticación que se saben reconocer. */
export type AuthSchemeType = "bearer" | "apikey" | "oauth2" | "none";

/**
 * El esquema de autenticación deducido, con la señal que lo delató.
 *
 * La `evidence` no es adorno: una detección automática que no se puede
 * contrastar hay que creérsela a ciegas.
 */
export interface IDetectedAuthScheme {
  readonly type: AuthSchemeType;
  /** Nombre de la cabecera o del query param, solo para `apikey`. */
  readonly keyName?: string;
  /** Dónde viaja la clave, solo para `apikey`. */
  readonly keyIn?: "header" | "query";
  /** URL del endpoint de token, solo para `oauth2`. */
  readonly tokenUrl?: string;
  /** URL de autorización, solo para `oauth2`. */
  readonly authorizeUrl?: string;
  /**
   * Por qué se ha decidido eso.
   *
   * Va al aviso del CLI y a la descripción de la colección: una
   * detección automática que no se puede contrastar es una que hay que
   * creerse a ciegas.
   */
  readonly evidence: string;
}

/** El bloque `auth` tal y como lo espera Postman. */
export interface IPostmanAuth {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** Los tres pasos del ciclo de sesión, cableados en la colección. */
export interface IAuthFlow {
  readonly login: PostmanItem | null;
  readonly refresh: PostmanItem | null;
  readonly logout: PostmanItem | null;
}

/** Ajustes opcionales del pipeline. */
export interface IGenerationOptions {
  /** Sobrescribe `config.collectionName` (flag `--basename`). */
  readonly collectionName?: string;
  /**
   * Catálogo de frameworks que se va a usar para detectar y escanear.
   *
   * Es obligatorio a propósito. Antes el pipeline importaba
   * `defaultOrchestrator()` del registro concreto, y eso metía los
   * scanners dentro del núcleo: `core` no podía compilarse, ni testearse,
   * ni razonarse sin arrastrar Laravel, Gin y Spring Boot. Un núcleo que
   * dice ser agnóstico no puede tener una arista hacia lo concreto.
   */
  readonly orchestrator: IDiscoveryOrchestrator;
  /**
   * Qué hacer cuando ningún scanner reconoce el proyecto.
   *
   * Opcional: sin fallback, un proyecto no reconocido devuelve cero
   * endpoints, que es una respuesta honesta.
   */
  readonly legacyFallback?: ILegacyDiscovery | undefined;
  /**
   * Framework a usar, saltándose la detección.
   *
   * Para cuando la autodetección no puede acertar: un monorepo cuyo
   * manifiesto está en la raíz, una dependencia con alias, un manifiesto
   * que se genera en el build.
   */
  readonly forceFramework?: string | undefined;
  /**
   * Subdirectorio del proyecto donde vive el framework, **relativo** a
   * `projectRoot`.
   *
   * Acepta dos formas de pasarlo:
   *
   *  - **Forzado** (CLI `--framework-search-root`, opción del plugin):
   *    se usa literalmente, sin mirar el árbol. Quien lo sabe de su
   *    API y no puede esperar a la autodetección lo da así.
   *  - **Auto**: si se omite y la raíz es un monorepo (turbo.json,
   *    pnpm-workspace.yaml, lerna.json o `package.json#workspaces`) con
   *    exactamente **un** workspace, el orquestador lo rellena solo.
   *    Con varios workspaces, no rellena nada: la elección entre
   *    `apps/api`, `apps/web` y `packages/auth` la hace quien conoce
   *    su repo.
   *
   * El valor resuelto acaba en `IProjectMatch.frameworkSearchRoot`,
   * que es lo que los scanners ya leen (f00011 S1). Aquí solo se
   * declara la entrada del pipeline; la asignación al `match` vive en
   * `generation.pipeline.ts`.
   *
   * **Nunca absoluto**: la raíz es siempre `projectRoot` y este campo
   * solo añade un segmento, igual que `--framework-search-root` en el CLI.
   * Concatenar con `process.cwd()` está vetado por el gate universal
   * de no-leer-globales-en-hot-path.
   *
   * Añadido en f00011 S3 (2026-09-03). S1 dejó el campo en
   * `IProjectMatch` y los scanners leyéndolo; S3 cierra el lado host
   * (CLI, config y orquestador).
   */
  readonly frameworkSearchRoot?: string | undefined;
  /**
   * `argv` que el pipeline pasa al loader (`loadProject`). Vacío por
   * defecto: el core NO lee `process.argv` en runtime — quien invoca
   * el pipeline (CLI, plugin MCP, UI web, tests) decide qué pasar.
   *
   * Si falta, el loader trata la ausencia como "ningún flag `--config`",
   * que es lo que ya hacía antes cuando `argv` no llegaba. El CLI pasa
   * `process.argv.slice(2)` desde `cli.script.ts` (composition root),
   * los tests pasan un array vacío o el que necesiten.
   *
   * a00012 S4.
   */
  readonly argv?: ReadonlyArray<string> | undefined;
}

/**
 * Lo que `detectMonorepo()` (`packages/core/discovery/monorepo-detector.helper.ts`)
 * devuelve. f00011 S3.
 *
 * Vive aquí —no al lado del helper— porque es una forma de dato que el
 * pipeline y los tests consumen, y `lint:contracts` exige que los
 * tipos compartidos entre implementaciones vivan en `contracts/`. El
 * helper es **puro** y solo se usa desde `generation.pipeline.ts` y
 * desde `tests/core/monorepo-detector.spec.ts`.
 */
export interface IMonorepoDetection {
  /** ¿Hay alguna señal estándar de monorepo en la raíz? */
  readonly isMonorepo: boolean;
  /**
   * El archivo exacto que se leyó para concluir `isMonorepo`.
   * `null` cuando no hay monorepo: así los avisos del pipeline pueden
   * decir "no se detectó monorepo" sin filtrar cuál de los cuatro se
   * miró primero.
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
