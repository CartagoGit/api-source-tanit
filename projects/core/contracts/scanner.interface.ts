/**
 * Contratos framework-agnostic para discovery y validación.
 *
 * El paquete `export-to-postman` produce colecciones Postman v2.1.0
 * independientemente del framework del proyecto host. Para admitir
 * Laravel, Symfony, Slim, Express, FastAPI, OpenAPI-3, etc. sin
 * reescribir el orquestador, todo el "input parsing" se hace a
 * través de tres interfaces:
 *
 *   - `IProjectScanner` — describe CÓMO se descubre el proyecto (qué
 *     archivos existen, qué framework es).
 *   - `IRouteScanner` — extrae rutas (method+uri) en un formato neutro.
 *   - `IValidationSpecProvider` — resuelve una ruta a `IValidationSpec`
 *     (reglas de campos) si el framework las define.
 *
 * Cada `IRouteScanner` y `IValidationSpecProvider` se asocia a un
 * `framework id` (ej. `"laravel"`, `"openapi"`). `discoverProject()`
 * corre todos los `IRouteScanner` registrados y se queda con el primero
 * que `detect()` (forward/declarative matcher).
 *
 * El shape de `ParsedRoute` está pensado para ser 1-1 traducible a
 * `EndpointSpec` (URI ya normalizada a Postman `{{x}}`).
 *
 * @see ./postman.interface.ts para los tipos Postman v2.1.0.
 */

/** ID estable del framework. Se usa como clave en config. */
export type FrameworkId = "laravel" | "openapi" | "express" | "fastapi" | "symfony" | string;

/** Resultado del sniffing inicial. */
export interface IProjectMatch {
  /** ID del framework (sluggable, kebab-case). */
  readonly framework: FrameworkId;
  /** Versión reportada por el manifest (composer.json version, etc.). */
  readonly version?: string;
  /** Raíz del proyecto resuelta. */
  readonly projectRoot: string;
  /** Rutas de artefactos extra relevantes (composer.json, openapi.yaml...). */
  readonly artifacts: ReadonlyArray<string>;
}

/** Detector declarativo: ¿este scanner sabe trabajar con este proyecto? */
export interface IProjectScanner {
  readonly framework: FrameworkId;
  /** Score (0-1) que indica la confianza. Si 0, no se intenta. */
  detect(projectRoot: string): Promise<number>;
  /** Construye el IProjectMatch final. Llamado solo si detect > 0. */
  resolve(projectRoot: string): Promise<IProjectMatch>;
}

/** Ruta en formato neutro. Se transforma a EndpointSpec al final. */
export interface ParsedRoute {
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
  /** Descripción libre del endpoint (summary de OpenAPI, docstring, etc.). */
  description?: string;
}

/** Ruta escaneada del proyecto host. */
export interface IRouteScanner {
  readonly framework: FrameworkId;
  /** Matchea con IProjectScanner.framework. */
  matches(match: IProjectMatch): boolean;
  /** Devuelve rutas en formato neutro. */
  scan(match: IProjectMatch): Promise<ReadonlyArray<ParsedRoute>>;
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
  /** ¿Tiene specs de validación para este endpoint? */
  supports(route: ParsedRoute, match: IProjectMatch): Promise<boolean>;
  /** Resuelve los campos. */
  resolve(route: ParsedRoute, match: IProjectMatch): Promise<IEndpointValidation>;
}

/** Punto de entrada principal: "dado un projectRoot, dame el scanner adecuado". */
export interface IDiscoveryOrchestrator {
  detectProject(projectRoot: string): Promise<{
    match: IProjectMatch | null;
    scanner: IRouteScanner | null;
    validation: IValidationSpecProvider | null;
  }>;
}
