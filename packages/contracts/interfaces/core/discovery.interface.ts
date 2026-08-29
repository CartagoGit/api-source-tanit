/**
 * El descubrimiento: quién reconoce un proyecto y qué sale de escanearlo.
 *
 * Todo lo de aquí son **formas de dato**, sin una línea ejecutable. Es lo
 * que permite que el plugin MCP o la interfaz web declaren la salida del
 * pipeline sin importar el pipeline —que arrastra los 21 scanners
 * detrás—, que es exactamente lo que hacían antes.
 */

import type {
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

/** El catálogo de detectores, scanners y proveedores de validación. */
export interface DiscoveryRegistry {
  readonly detectors: ReadonlyArray<IProjectScanner>;
  readonly routeScanners: ReadonlyArray<IRouteScanner>;
  readonly validationProviders: ReadonlyArray<IValidationSpecProvider>;
}

/** Un framework que ha reconocido el proyecto, con sus colaboradores. */
export interface IDetectedFramework {
  readonly match: IProjectMatch;
  readonly scanner: IRouteScanner | null;
  readonly validation: IValidationSpecProvider | null;
  /** Confianza del detector, de 0 a 1. */
  readonly score: number;
}

/**
 * Quien decide qué framework es el proyecto.
 *
 * Existe como interfaz —y no solo como la clase que la implementa— para
 * que `IGenerationOptions` pueda vivir aquí. Con la clase en la firma,
 * declarar las opciones del pipeline obligaba a importar el orquestador,
 * y con él su registro entero. Es la regla de siempre: quien consume
 * depende de la abstracción, no de quien la cumple.
 */
export interface IDiscoveryOrchestrator {
  /** Todos los que reconocen el proyecto, ordenados por confianza. */
  detectAll(projectRoot: string): Promise<IDetectedFramework[]>;
  /** Fuerza un framework concreto, saltándose la detección. */
  forceFramework(
    framework: string,
    projectRoot: string,
  ): Promise<IDetectedFramework | null>;
  /** Los identificadores que este catálogo sabe reconocer. */
  supportedFrameworks(): string[];
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
