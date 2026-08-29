/**
 * Lo que declaran los scanners y los parsers de cada framework.
 *
 * Aquí no hay nada de un framework concreto: son las **formas** con las
 * que cada uno describe lo que encuentra —los campos de un esquema Zod,
 * las reglas de un FormRequest de Laravel, un procedimiento de tRPC— y
 * las opciones con las que se le puede ajustar.
 *
 * Viven fuera de `projects/frameworks/` porque quien las consume no
 * debería cargar el scanner que las produce. Es el mismo motivo por el
 * que el catálogo de nombres salió del registro: leer una interfaz no
 * puede costar veinte kilobytes de expresiones regulares.
 */

import type { IGenerationOptions } from "../core/discovery.interface.js";
import type {
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute as NeutralParsedRoute,
} from "../core/scanner.interface.js";

/** Lo que se puede ajustar sin tocar el catálogo. */
export type IGenerateOptions = Omit<IGenerationOptions, "orchestrator">;

/** Trío de colaboradores de un framework, o `null` si no está soportado. */
export interface IScannerBundle {
  readonly projectScanner: IProjectScanner;
  readonly routeScanner: IRouteScanner;
  readonly validationProvider: IValidationSpecProvider | null;
}

/** Un modelo Pydantic localizado en el fuente. */
export interface IPydanticModel {
  readonly className: string;
  /** Nombre del campo → anotación de tipo tal cual aparece. */
  readonly fields: ReadonlyMap<string, string>;
  /** Línea (0-based) donde arranca la clase. */
  readonly line: number;
}

/** Un schema Marshmallow localizado en el fuente. */
export interface IMarshmallowSchema {
  readonly className: string;
  /** Nombre del campo → expresión `fields.X(...)` completa. */
  readonly fields: ReadonlyMap<string, string>;
  /** Línea (0-based) donde arranca la clase. */
  readonly line: number;
}

/** Campo zod ya parseado, antes de convertirse en `IValidationSpec`. */
export interface IZodField {
  readonly name: string;
  readonly type: IValidationSpec["type"];
  readonly required: boolean;
  readonly format?: string;
  readonly enumValues?: ReadonlyArray<string>;
  /**
   * El argumento de `.min()`, **sin interpretar**.
   *
   * En zod, `.min()` es el mismo método con dos significados según el
   * tipo base: `z.string().min(2)` son dos caracteres y
   * `z.number().min(2)` es el valor dos. Se guarda crudo aquí y lo
   * clasifica `zodFieldToSpec`, que es quien conoce el tipo.
   *
   * Antes iba directo a `minLength`, así que un `z.number().min(0).max(120)`
   * producía un campo numérico con `minLength: 0` y `maxLength: 120` —
   * restricciones que no significan nada sobre un número, y que las
   * herramientas que leen el JSON Schema ignoran. La cota se perdía.
   */
  readonly min?: number;
  readonly max?: number;
}

/** Campo Joi ya parseado, antes de convertirse en `IValidationSpec`. */
export interface IJoiField {
  readonly name: string;
  readonly type: IValidationSpec["type"];
  readonly required: boolean;
  readonly format?: string;
  readonly enumValues?: ReadonlyArray<string>;
  readonly minLength?: number;
  readonly maxLength?: number;
}

export interface OpenApiScannerOptions {
  /** Path explícito al spec. Si se da, ignora OPENAPI_CANDIDATES. */
  readonly specPath?: string;
  /** Base path a prepender a todas las URIs (ej. "/api/v2"). */
  readonly basePath?: string;
}

/** Un procedimiento con su ruta completa dentro del router. */
export interface ITrpcProcedure {
  /** `users.list`, con los routers anidados separados por punto. */
  readonly path: string;
  readonly kind: "query" | "mutation" | "subscription";
}

export interface LaravelScannerOptions {
  /** Mapa archivo → prefijos. Si null, autodetecta del RouteServiceProvider. */
  readonly filePrefixes?: Record<string, string[]>;
}

/**
 * Re-export del tipo neutro para no romper imports existentes.
 * `route-parser.service.ts` se mantiene como IMPLEMENTACIÓN Laravel
 * del contrato `IRouteScanner` (ver `services/scanners/laravel.scanner.ts`).
 */
export type ParsedRoute = NeutralParsedRoute;

export interface FormRequestRules {
  /** Ruta al FormRequest parseado (relativa al repo). */
  sourceFile: string;
  /** Nombre de la clase FormRequest. */
  className: string;
  /** Reglas extraídas como `campo → [reglas...]`. */
  rules: Record<string, string[]>;
  /** Reglas que no se pudieron procesar (se mantienen literales). */
  unknown: Array<{ field: string; rule: string }>;
  /** Si el método rules() devolvía `[]` o era dinámico. */
  isEmpty: boolean;
}

export interface BodyVariant {
  /** Nombre visible en Postman (p. ej. "Mínimo", "Completo"). */
  name: string;
  body: Record<string, unknown>;
}

export interface QueryVariant {
  name: string;
  query: Array<{ key: string; value: string; description: string }>;
}

export interface EnrichmentStats {
  bodyVariants: number;
  queryVariants: number;
  skippedManualBody: number;
  unresolved: number;
  resolved: number;
  rulesWithUnknown: Array<{ formRequest: string; unknown: string[] }>;
}

/** Clave method+uri normalizada → ruta relativa del FormRequest. */
export type FormRequestIndex = Map<string, string>;
