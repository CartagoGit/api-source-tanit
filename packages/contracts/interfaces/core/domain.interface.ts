/**
 * Lo que el dominio produce y consume: opciones y resultados.
 *
 * Aquí viven las formas de dato de los servicios que construyen la
 * colección, hablan con la API de Postman o vigilan el proyecto. Ninguna
 * trae código: son lo que un consumidor necesita para declarar qué
 * recibe sin arrastrar el servicio que se lo da.
 *
 * `IProjectSummary` es el caso que motivó la sección entera. La interfaz
 * web lo importaba de `core/discovery/summary.service`, o sea que para
 * tipar un resumen se llevaba el pipeline completo por delante.
 */

/**
 * Lo que el host puede declarar para ayudar a cablear la sesión.
 *
 * Las dos son **último recurso**, no configuración esperada: el flujo
 * detecta el login por método y URI, y el token probando los caminos
 * habituales de la respuesta en ejecución. Antes se exigía declarar el
 * camino del token, y el resultado fue que no se activaba en ninguno de
 * los once proyectos de ejemplo.
 */
export interface IApplyAuthFlowOptions {
  /**
   * Camino declarado por el host (`config.tokenResponsePath`). Si viene,
   * es el único que se prueba; si no, se prueban los habituales.
   */
  readonly tokenResponsePath?: string | undefined;
  /**
   * Nombre exacto del endpoint de login declarado por el host. Solo se
   * usa como último recurso, si la detección por URI no encuentra nada.
   */
  readonly loginEndpointName?: string | undefined;
}

/** Definición de un entorno (agnóstica del proyecto). */
export interface EnvironmentDef {
  /** Nombre que verá el usuario en Postman. */
  name: string;
  /** Color opcional en formato #RRGGBB. */
  color?: string;
  /** Mapa clave → valor que SOBREESCRIBE las variables base. */
  overrides?: Record<string, string>;
}

/** El body inferido para un endpoint y con qué confianza se dedujo. */
export interface BodyInference {
  /** Filename o heurística que produjo el body. */
  reason: string;
  body: Record<string, unknown>;
}

/**
 * Cuánto ha rellenado la inferencia agnóstica.
 *
 * Lo imprime el CLI: es la forma de ver de un vistazo cuánto viene del
 * código y cuánto de una heurística.
 */
export interface InferApplyStats {
  bodiesAdded: number;
  queriesAdded: number;
  variableInferred: number;
  skippedManual: number;
}

/** Environment de Postman, tal como lo emite `environment-builder`. */
export interface IPostmanEnvironmentPayload {
  readonly id?: string;
  readonly name: string;
  readonly values: ReadonlyArray<Record<string, unknown>>;
}

/** Resultado de subir un artefacto. */
export interface IPushResult {
  /** `"created"` si no existía, `"updated"` si se sobrescribió. */
  readonly action: "created" | "updated";
  /** UID que Postman asigna (`<userId>-<uuid>`). */
  readonly uid: string;
  readonly name: string;
}

/** Opciones comunes de todas las llamadas. */
export interface IPostmanApiOptions {
  readonly apiKey: string;
  /** Workspace destino. Si falta, va al workspace personal por defecto. */
  readonly workspaceId?: string | undefined;
  /** Inyectable para poder testear sin red. */
  readonly fetchImpl?: typeof fetch;
}

/** Qué vigilar, con cuánto rebote, y qué hacer cuando algo cambia. */
export interface IWatchOptions {
  /** Raíz del proyecto a vigilar. */
  readonly root: string;
  /** Milisegundos de espera tras el último cambio. */
  readonly debounceMs?: number;
  /** Carpetas extra a ignorar, además de las de siempre. */
  readonly ignoreDirs?: ReadonlySet<string>;
  /** Qué hacer cuando un lote de cambios se asienta. */
  readonly onChange: (changed: readonly string[]) => void | Promise<void>;
}

/** Lo que devuelve `watchProject` para poder parar. */
export interface IWatchHandle {
  close(): void;
}

/** Lo que devuelve el parseo de `--format`. */
export type IParsedFormats =
  | { readonly ok: true; readonly formats: string[] }
  | { readonly ok: false; readonly invalid: string[]; readonly valid: string[] };

/** Resumen de un proyecto host para inspección rápida. */
export interface IProjectSummary {
  /** Framework detectado. `"unknown"` si no lo reconoció ninguno. */
  framework: string;
  /**
   * Todos los frameworks que reconocieron el proyecto.
   *
   * Más de uno significa proyecto híbrido, y entonces `framework` es
   * solo el de más confianza.
   */
  frameworks: ReadonlyArray<string>;
  /** Nombre del proyecto, del manifiesto de su ecosistema. */
  projectName: string;
  /** BaseUrl efectiva. */
  baseUrl: string;
  /**
   * Endpoints que acabarían en la colección.
   *
   * No es "rutas declaradas en el código": un `apiResource` de Laravel
   * es una línea y siete endpoints, y lo que importa es el segundo
   * número.
   */
  routesInCode: number;
  /** Endpoints cuyas reglas de validación se resolvieron. */
  withFormRequest: number;
  /** Endpoints sin reglas: su body sale de la inferencia agnóstica. */
  withoutFormRequest: number;
  /** Bodies auto-rellenados por la heurística agnóstica. */
  bodiesAdded: number;
  /** Queries auto-rellenadas por la heurística agnóstica. */
  queriesAdded: number;
  /** Modo "zero-config" (no se encontró `config.constant.ts`). */
  zeroConfig: boolean;
  /** Ruta al `config.constant.ts` cargado, o `"<zero-config>"`. */
  configPath: string;
  /** Endpoints definidos manualmente como override. */
  manualEndpoints: number;
  /** Variables de colección derivadas de las rutas. */
  inferredVariables: number;
  /** `null` si el proyecto no expone un endpoint de login. */
  auth: { readonly loginEndpoint: string } | null;
  /** Avisos accionables: proyecto híbrido, nada reconocido… */
  warnings: ReadonlyArray<string>;
  /**
   * Las señales que motivaron la elección del framework.
   *
   * Cada elemento es una cosa que el detector vio y la subida exacta
   * al score. La CLI los imprime bajo `¿Por qué ${framework}?`; el
   * tool MCP los expone en `summary.evidence`; la UI los pinta como
   * tarjetas con icono. Es lo que convierte "framework: express
   * (0.9)" en "porque `package.json` declara express en deps".
   *
   * Vacío si el detector aún no se ha enriquecido (la mayoría, hoy).
   */
  evidence: ReadonlyArray<import("./scanner.interface.js").IProjectDetectionEvidence>;
}
