/**
 * What scanners and parsers declare per framework.
 *
 * There is nothing framework-specific here: these are the **shapes**
 * each one uses to describe what it finds —the fields of a Zod
 * schema, the rules of a Laravel FormRequest, a tRPC procedure— and
 * the options it can be tuned with.
 *
 * They live outside `packages/frameworks/` because consumers should
 * not have to load the scanner that produces them. It is the same
 * reason the naming catalogue was extracted from the registry:
 * reading an interface must not cost twenty kilobytes of regex.
 */

import type { IGenerationOptions } from "../core/discovery.interface.js";
import type {
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute as NeutralParsedRoute,
} from "../core/scanner.interface.js";

/** What can be tuned without touching the catalogue. */
export type IGenerateOptions = Omit<IGenerationOptions, "orchestrator">;

/** Triad of framework collaborators, or `null` if not supported. */
export interface IScannerBundle {
  readonly projectScanner: IProjectScanner;
  readonly routeScanner: IRouteScanner;
  readonly validationProvider: IValidationSpecProvider | null;
}

/** A Pydantic model located in the source. */
export interface IPydanticModel {
  readonly className: string;
  /** Field name → type annotation as it appears. */
  readonly fields: ReadonlyMap<string, string>;
  /** Line (0-based) where the class starts. */
  readonly line: number;
}

/** A Marshmallow schema located in the source. */
export interface IMarshmallowSchema {
  readonly className: string;
  /** Field name → full `fields.X(...)` expression. */
  readonly fields: ReadonlyMap<string, string>;
  /** Line (0-based) where the class starts. */
  readonly line: number;
}

/** Zod field already parsed, before becoming an `IValidationSpec`. */
export interface IZodField {
  readonly name: string;
  readonly type: IValidationSpec["type"];
  readonly required: boolean;
  readonly format?: string;
  readonly enumValues?: ReadonlyArray<string>;
  /**
   * The argument of `.min()`, **uninterpreted**.
   *
   * In zod, `.min()` is the same method with two meanings depending
   * on the base type: `z.string().min(2)` is two characters and
   * `z.number().min(2)` is the value two. We store it raw here and
   * `zodFieldToSpec` classifies it, since it knows the type.
   *
   * Previously it went straight to `minLength`, so a
   * `z.number().min(0).max(120)` produced a numeric field with
   * `minLength: 0` and `maxLength: 120` — constraints that mean
   * nothing about a number, and that JSON Schema consumers ignore.
   * The bound was lost.
   */
  readonly min?: number;
  readonly max?: number;
}

/** Joi field already parsed, before becoming an `IValidationSpec`. */
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
  /** Explicit path to the spec. If given, ignores OPENAPI_CANDIDATES. */
  readonly specPath?: string;
  /** Base path to prepend to all URIs (e.g. "/api/v2"). */
  readonly basePath?: string;
}

/**
 * Options for collecting SDL embedded in tagged templates
 * (graphql-embedded scanner). The shape lives here, in
 * `contracts/`, so consumers can type the call site without
 * dragging the implementation; the helper itself imports it.
 *
 * The list of accepted tags is the only knob today. Future
 * options (interpolation resolution, etc.) belong here too,
 * not as a second parameter to `collectEmbeddedSdl`.
 */
export interface ICollectEmbeddedSdlOptions {
  /** Tags accepted as embedded SDL. Default: `["gql", "graphql"]`. */
  readonly tags?: ReadonlyArray<string>;
}

/** A procedure with its full path inside the router. */
export interface ITrpcProcedure {
  /** `users.list`, with nested routers separated by dots. */
  readonly path: string;
  readonly kind: "query" | "mutation" | "subscription";
}

export interface LaravelScannerOptions {
  /** file → prefixes map. If null, autodetects from RouteServiceProvider. */
  readonly filePrefixes?: Record<string, string[]>;
}

/**
 * Re-export of the neutral type to avoid breaking existing imports.
 * `route-parser.service.ts` stays as the Laravel IMPLEMENTATION of
 * the `IRouteScanner` contract (see
 * `services/scanners/laravel.scanner.ts`).
 */
export type ParsedRoute = NeutralParsedRoute;

export interface FormRequestRules {
  /** Path to the parsed FormRequest (relative to the repo). */
  sourceFile: string;
  /** Name of the FormRequest class. */
  className: string;
  /** Rules extracted as `field → [rules...]`. */
  rules: Record<string, string[]>;
  /** Rules that could not be processed (kept as literals). */
  unknown: Array<{ field: string; rule: string }>;
  /** Whether the rules() method returned `[]` or was dynamic. */
  isEmpty: boolean;
}

export interface BodyVariant {
  /** Visible name in Postman (e.g. "Minimal", "Full"). */
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
