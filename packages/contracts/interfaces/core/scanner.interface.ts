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

/** Lo que `IProjectScanner.detect` devuelve. */
export interface IProjectScannerResult {
  /** Score 0-1. Si 0, el orquestador lo descarta. */
  readonly score: number;
  /** Las señales que subieron el score. */
  readonly evidence: ReadonlyArray<IProjectDetectionEvidence>;
}

/** Una señal individual de detección, expuesta a través de la UI. */
export interface IProjectDetectionEvidence {
  /** Qué vio el detector, en una línea legible. */
  readonly signal: string;
  /** Subida al score que aportó esta señal. */
  readonly weight: number;
  /** Fichero del que se leyó la señal (relativo al projectRoot). */
  readonly artifact?: string;
}

/** Ruta en formato neutro. Se transforma a EndpointSpec al final. */
export interface ParsedRoute {
  /**
   * De qué scanner viene esta ruta.
   *
   * Sin este campo, una ruta no podía decir quién la había producido, y
   * el scanner de OpenAPI se inventó una propiedad escondida
   * (`__params`) colada con `as any` para reconocer las suyas en un
   * proyecto híbrido — donde `match.framework` es el del framework
   * dominante, no el de cada ruta.
   *
   * Es opcional porque lo rellena el pipeline al recoger lo que devuelve
   * cada scanner: obligar a los veintiún scanners a repetir su propio id
   * en cada ruta sería pedirles que se acuerden de algo que el registro
   * ya sabe.
   */
  framework?: FrameworkId;
  /** Método HTTP en MAYÚSCULAS. */
  method: string;
  /** URI completa resuelta con prefijos. SIN `api/` si el scanner ya lo aplicó. */
  uri: string;
  /** URI sin prefijos (la que puso el dev en `Route::get('...')`). */
  rawUri: string;
  /** Origen: archivo de rutas o nombre del spec (ej. "openapi.yaml#/paths/~1users"). */
  sourceFile: string;
  /** 1-based line number en `sourceFile` (0 si no aplica). */
  lineNumber: number;
  /** Cadena de prefijos activos al declarar la ruta. */
  prefixChain: string[];
  /** FQCN del controlador si se pudo resolver (ej. `App\Http\…`). */
  controllerClass?: string;
  /** Nombre del método del controlador (ej. `index`). */
  actionName?: string;
  /** Nombre legible del endpoint (auto-derivado si no se da). */
  displayName?: string;
  /** Tags / grupos semánticos (ej. OpenAPI tags). */
  tags?: ReadonlyArray<string>;
  /**
   * Cuerpo exacto de la petición, cuando el scanner lo conoce.
   *
   * Lo normal es que no: de un `POST /users` se sacan las **reglas** de
   * validación y el ejemplo se construye a partir de ellas. Pero hay
   * protocolos donde el cuerpo no es un conjunto de campos sino un
   * documento concreto — la consulta de GraphQL es el caso — y
   * descomponerla en campos para volver a montarla la estropearía.
   *
   * Si viene, gana sobre lo que infiera el adapter.
   */
  body?: unknown;
  /** Descripción libre del endpoint (summary de OpenAPI, docstring, etc.). */
  description?: string;  /**
   * Override de auth declarado por el scanner para ESTA ruta.
   *
   * Audit 2ª revisión #17: sin este campo, los scanners no pueden
   * declarar "este endpoint es público" / "usa apiKey" desde su
   * contrato neutral. Solo lo que el adapter ya conoce (`body`,
   * `fields`) sobrevivía; el auth tenía que venir de la heurística
   * global del pipeline. Ahora, si un scanner detecta que una ruta
   * específica rompe la convención del framework (p. ej. una ruta
   * de login en un proyecto con bearer global), puede declarar el
   * override aquí y el merger lo respeta.
   */
  auth?: IEndpointAuth;}

/**
 * Lo que devuelve `IRouteScanner.scan()`.
 *
 * Antes los scanners guardaban en un `Map` de instancia los esquemas /
 * validators / structs que iban encontrando: dos invocaciones sobre el
 * mismo scanner contaminaban el resultado, y eso dejó bugs reales
 * (cerrados en a00010 S2). La forma honesta es que el estado **viva
 * en la salida de `scan()`** y se descarte al terminar la llamada —
 * si la siguiente necesita otra vez los datos, los recomputa.
 *
 * `routes` son las rutas en formato neutro. Los mapas auxiliares son
 * **opcionales y agnósticos del tipo**: cada scanner los puebla como
 * buenamente pueda, y solo los consume su propio provider en la misma
 * llamada. Un mapa vacío significa "este scanner no recogió nada
 * auxiliar"; `undefined` significa "no aplica a este framework".
 *
 * El shape abierto (`schemas` como `Map<string, string>`, `validators`
 * y `structs` como `Map<string, I…Descriptor>`) viene de que los
 * cuatro frameworks tienen dialectos distintos: Fastify lleva el JSON
 * Schema dentro de la propia ruta, Hono monta el validador con
 * `zValidator(...)` y necesita saber en qué fichero está el esquema
 * zod, Fiber y Rust leen el body con `BodyParser` / `web::Json<T>` y
 * tienen que abrir el struct declarado en otro sitio. Echarlo todo a
 * un mismo `Map<string, string>` obligaría a duplicar el descriptor
 * dentro del string serializado.
 */
export interface IScanResult {
  readonly routes: ReadonlyArray<ParsedRoute>;
  /**
   * Mapa `${method} ${uri}` → descriptor auxiliar.
   *
   * Lo usa `FastifyRouteScanner` para guardar el JSON Schema declarado
   * en la propia ruta. Los demás frameworks lo dejan `undefined`.
   */
  readonly schemas?: ReadonlyMap<string, string>;
  /**
   * Los descriptores del validador, indexados por `${method} ${uri}`.
   *
   * Solo `HonoRouteScanner` lo rellena: el nombre del esquema zod
   * con el que `zValidator(...)` valida, más el fichero donde está
   * declarado (es típicamente OTRO fichero).
   */
  readonly validators?: ReadonlyMap<string, IValidatorDescriptor>;
  /**
   * Los structs que parsean el body en Go/Rust, indexados igual.
   *
   * Lo usan `FiberRouteScanner` y `RustRouteScanner`: el struct al que
   * apunta `BodyParser` / `web::Json<T>`, más el fichero donde
   * está declarado.
   */
  readonly structs?: ReadonlyMap<string, IStructDescriptor>;
  /**
   * Errores no fatales encontrados durante el scan: ficheros que un
   * parser de terceros no pudo procesar pero que no abortan el scan.
   *
   * Lo rellena `ExpressRouteScanner` desde `parseModule` del frontend
   * TypeScript: un fichero con sintaxis inválida sale como `null` en el
   * AST y deja aquí la razón, para que no desaparezca sin rastro.
   */
  readonly diagnostics?: ReadonlyArray<IParseDiagnostic>;
}

/**
 * Un problema de parseo no fatal: el fichero no se pudo procesar,
 * pero el scan continúa.
 *
 * Vive en este paquete (no en el del frontend) para que scanners de
 * cualquier lenguaje puedan reutilizarlo — el shape es agnóstico.
 */
export interface IParseDiagnostic {
  /** Fichero que no se pudo procesar (tal como se pasó al parser). */
  readonly file: string;
  readonly severity: "error" | "warning";
  /** Razón legible: el mensaje del parser, sin stack. */
  readonly reason: string;
}

/**
 * Lo que Hono asocia a una ruta: nombre del esquema + ruta del
 * fichero donde está declarado.
 *
 * El nombre se queda solo para los mensajes de error; los campos se
 * leen parseando el `z.object({…})` que vive en `file`.
 */
export interface IValidatorDescriptor {
  readonly name: string;
  readonly file: string;
}

/** Lo que Fiber y Rust asocian a una ruta: el struct que parsea el body. */
export interface IStructDescriptor {
  readonly name: string;
  readonly file: string;
}

/**
 * Ruta escaneada del proyecto host. */
export interface IRouteScanner {
  readonly framework: FrameworkId;
  /** Matchea con IProjectScanner.framework. */
  matches(match: IProjectMatch): boolean;
  /**
   * Devuelve las rutas y los artefactos auxiliares en un objeto.
   *
   * El resultado **no se reutiliza entre llamadas**: cada scanner es
   * stateless respecto a invocaciones anteriores, y los `Map` que
   * pueda necesitar viven dentro de este método y se descartan al
   * volver. Antes los cuatro scanners afectados por a00010 B-06
   * guardaban esos `Map` como `private readonly`, y dos escaneos
   * consecutivos compartían el resultado.
   */
  scan(match: IProjectMatch): Promise<IScanResult>;
}

/** Especificación de validación de un parámetro (agnostic). */
export interface IValidationSpec {
  /** Nombre del campo (en la key del body / query / path). */
  fieldName: string;
  /** 'body' | 'query' | 'path' | 'header' | 'cookie'. */
  location: "body" | "query" | "path" | "header" | "cookie";
  /** Tipo lógico. */
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
  /** ¿Es obligatorio? */
  required: boolean;
  /** Si type === 'enum', valores permitidos. */
  enumValues?: ReadonlyArray<string>;
  /** Formato semántico (email, uuid, url, ipv4…). */
  format?: string;
  /** Tope de longitud (string) o cardinalidad (array). */
  maxLength?: number;
  /** Piso de longitud. */
  minLength?: number;
  /** Valor mínimo (number/date). */
  minimum?: number;
  /** Valor máximo (number/date). */
  maximum?: number;
  /** Patrón regex declarado por el framework. */
  pattern?: string;
  /** Descripción libre (de la docstring / schema). */
  description?: string;
  /** Ejemplo declarado por el framework. */
  example?: unknown;
}

/** Especificación de validación para un endpoint concreto. */
export interface IEndpointValidation {
  /** Endpoint al que aplica (clave method+uri normalizada). */
  readonly endpointKey: string;
  /** Reglas por location. */
  readonly fields: ReadonlyArray<IValidationSpec>;
}

/** Provider de ValidationSpec para un framework. */
export interface IValidationSpecProvider {
  readonly framework: FrameworkId;
  /**
   * ¿Tiene specs de validación para este endpoint?
   *
   * `scanResult` es lo que acaba de devolver `IRouteScanner.scan()`
   * para el mismo `match`. Los providers que no necesitan auxiliares
   * (los dieciséis que NO son Fastify/Hono/Fiber/Rust) lo ignoran.
   */
  supports(
    route: ParsedRoute,
    match: IProjectMatch,
    scanResult: IScanResult,
  ): Promise<boolean>;
  /**
   * Resuelve los campos.
   *
   * El contrato exige `scanResult` aunque la mayoría de providers no
   * lo miren: así los cuatro que sí lo necesitan (Fastify, Hono,
   * Fiber, Rust) leen directamente sus mapas del resultado del
   * scanner, sin depender de estado oculto. Es lo que cerró a00010
   * S2 — antes compartían una instancia del scanner con un `Map`
   * mutable, y dos escaneos consecutivos se contaminaban.
   */
  resolve(
    route: ParsedRoute,
    match: IProjectMatch,
    scanResult: IScanResult,
  ): Promise<IEndpointValidation>;
}

/**
 * Un framework que ha reconocido el proyecto, con sus colaboradores.
 *
 * Vive aquí —no en `discovery.interface.ts`— porque `IDiscoveryOrchestrator`
 * la devuelve y el contrato del orchestrator vive en esta casa: junto a
 * los scanners que producen el `evidence`, no junto al pipeline que los
 * consume. Tener dos declaraciones del mismo tipo en módulos distintos
 * es una grieta por la que se cuela la deriva; las interfaces se
 * fusionan en TS, pero el contrato conceptual deja de ser único.
 */
export interface IDetectedFramework {
  readonly match: IProjectMatch;
  readonly scanner: IRouteScanner | null;
  readonly validation: IValidationSpecProvider | null;
  /** Confianza del detector, de 0 a 1. */
  readonly score: number;
  /** Las señales que motivaron la puntuación. */
  readonly evidence: ReadonlyArray<IProjectDetectionEvidence>;
}

/**
 * Punto de entrada principal: "dado un projectRoot, dame el scanner adecuado".
 *
 * `forceFramework` recibe **un objeto nombrado** con `projectRoot` y
 * `framework`. Antes la firma era `(framework, projectRoot)` en la
 * interfaz y `(projectRoot, framework)` en la implementación —
 * incompatibles, pero `string` y `string` pasan por TypeScript sin
 * chistar. Un implementador externo perfectamente conforme con el
 * contrato público recibía los argumentos invertidos sin error de
 * tipo. El objeto nomado cierra el bug: la clave, no la posición,
 * decide el rol.
 */
export interface IDiscoveryOrchestrator {
  /** Todos los que reconocen el proyecto, ordenados por confianza. */
  detectAll(projectRoot: string): Promise<IDetectedFramework[]>;
  /** Fuerza un framework concreto, saltándose la detección. */
  forceFramework(
    args: { projectRoot: string; framework: string },
  ): Promise<IDetectedFramework | null>;
  /** Los identificadores que este catálogo sabe reconocer. */
  supportedFrameworks(): string[];
}
