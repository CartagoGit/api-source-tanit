/**
 * Response inference contracts (audit 2026-09-06 §10, proposal
 * `f00012` S1).
 *
 * Today Tanit analyses *what the API receives* (request shape,
 * validation rules, decorators, FormRequests, DTOs) and
 * materialises it on `EndpointSpec.body`, `.fields`, `.schemaGraph`.
 * What the API *returns* (response shape, status codes, success and
 * error schemas) is **not** inferred by any scanner yet — the
 * exporter collections ship without a response example.
 *
 * This file introduces the **types** to support inference without
 * coupling the contracts to a specific framework: every scanner
 * plugin that has a strong signal (NestJS decorators, FastAPI
 * `-> UserResponse` return annotation, Spring `@ApiResponse`, etc.)
 * will register an `IResponseInferrer` that produces zero or more
 * `IResponseInference` entries; the dispatcher (`inferResponses`)
 * composes them and the exporters render the result.
 *
 * The shape is the common denominator across the framework
 * inferrers: a **single response** carries
 *
 * - `status`: HTTP status code (number, not string — 200, 201, 204,
 *   400, 401, 403, 404, 409, 422, 500).
 * - `schema`: the response body schema. Free-form on purpose: a
 *   Pydantic model on FastAPI, a TypeScript type on NestJS, a
 *   Swagger annotation on Spring, an empty `{}` shape on
 *   Express fallback. We keep the property as a tagged union so
 *   consumers can either consume the broad `IResponseSchema` or
 *   narrow on `.kind`.
 * - `confidence`: high when an explicit annotation (decorator,
 *   signature annotation, OpenAPI source) drives the inference;
 *   medium when the return type alone drove it; low when we
 *   fell back to `res.json(...)` shape inference or the handler
 *   was untyped.
 * - `reason`: short human-readable description of **which signal**
 *   produced the entry. Mandatory even at `confidence: "high"`
 *   because the user needs to know what to trust.
 *
 * `confidence` and `reason` are exported alongside the schema so
 * the Postman exporter can render them inline (it does, today,
 * for `IEndpointConfidence`) and the OpenAPI exporter can emit
 * `x-tanit-confidence` + `description`.
 */
import type { ISchemaGraph } from "./schema.interface.js";

/**
 * Canonical HTTP status codes we track. Other codes are not
 * excluded (a `503` from `@HttpCode(503)` on NestJS would land
 * here as a plain `number`), but the OpenAPI / Postman exporters
 * render those as-is too.
 */
export type IResponseStatus = number;

/**
 * Confidence the inferrer has in this single response entry.
 *
 * Same categorical vocabulary as `IEndpointConfidence`:
 *
 * - `high`:   an **explicit** annotation named this status +
 *             schema (decorator on NestJS, OpenAPI source,
 *             `@ApiResponse(200, type: UserDto)` on Spring).
 * - `medium`: the **return type** of the handler drove it (TS
 *             AST on NestJS, `-> UserResponse` on FastAPI) but
 *             no per-status annotation named it.
 * - `low`:    a fall-back produced it (`res.json(value)` with
 *             `value` untyped, no annotation, no return type).
 */
export type IResponseInferenceConfidence = "high" | "medium" | "low";

/**
 * Response body schema. Loose on purpose — the framework inferrer
 * that produced this entry fills in the most appropriate shape:
 *
 * - `"schema-graph"`: structural — we have an `ISchemaGraph`.
 * - `"ref"`: the schema lives elsewhere (a `$ref` in an OpenAPI
 *   stub or a TS type alias in another file).
 * - `"empty"`: the inferrer observed `void` / `204 No Content` /
 *   `ResponseEntity` with no body — schema intentionally empty.
 *
 * The Postman exporter renders `"schema-graph"` as a Postman
 * `response[].body` JSON example; `"ref"` as
 * `{ "_ref": "<ref>" }` placeholder; `"empty"` as an empty
 * `{}` body with `description: "no body"`.
 */
export type IResponseSchema =
  | { readonly kind: "schema-graph"; readonly graph: ISchemaGraph }
  | { readonly kind: "ref"; readonly $ref: string }
  | { readonly kind: "empty" };

/**
 * One entry the inferrer (or composition of inferrers) produced
 * for an endpoint. Stable, comparable: `(status, schema-fingerprint,
 * reason)` is the export-side dedupe key.
 */
export interface IResponseInference {
  /** HTTP status code this entry describes. */
  readonly status: IResponseStatus;
  /** The body schema the inferrer attaches to this status. */
  readonly schema: IResponseSchema;
  /** Confidence the inferrer assigns to this entry. */
  readonly confidence: IResponseInferenceConfidence;
  /**
   * Short human-readable reason. **Always** populated — empty
   * string is treated as a bug by the dispatcher and dropped.
   *
   * Examples:
   * - `"@ApiResponse(200, type: UserDto)"`
   * - `"NestJS return type Promise<UserDto>"`
   * - `"FastAPI return annotation -> UserResponse"`
   * - `"res.json(untyped)"`
   */
  readonly reason: string;
}

/**
 * A single framework inferrer. Implementations live in
 * `packages/frameworks/scanners/<framework>/<framework>.response-inferrer.ts`
 * (one per framework, like the scanners). The dispatcher
 * `inferResponses()` loops through every registered inferrer
 * whose `framework` matches the spec's source framework.
 */
export interface IResponseInferrer {
  /** Framework slug the inferrer registers against (matches `IProjectMatch.framework`). */
  readonly framework: string;
  /**
   * Inspect the source file + spec and emit zero or more
   * response entries. **Never throw**: the dispatcher wraps
   * every call in a `try/catch`; an inferrer that crashes
   * becomes a warning and the rest of the entries survive.
   *
   * Return `[]` when no signal exists (untyped handler, no
   * decorator, no return annotation). Returning `[{...}]`
   * with `confidence: "low"` is **also** allowed when the
   * signal is fuzzy.
   */
  infer(
    spec: EndpointSpecLike,
    source: IFrameworkSourceFileLike,
  ): ReadonlyArray<IResponseInference>;
}

/**
 * Minimal `EndpointSpec` projection the inferrer needs. We
 * don't import `EndpointSpec` directly to avoid a circular
 * import (`EndpointSpec` lives in `postman.interface.ts`, which
 * imports `IResponseInference` from this file). The inferrer
 * receives whatever it needs through this structural type and
 * the caller is responsible for the shape.
 */
export interface EndpointSpecLike {
  readonly method: string;
  readonly uri: string;
  readonly sourceFile?: string;
  readonly lineNumber?: number;
}

/** Minimal source-file projection the inferrer reads. */
export interface IFrameworkSourceFileLike {
  /** Absolute path to the source file. */
  readonly path: string;
  /** UTF-8 decoded file content. */
  readonly content: string;
  /** Framework slug (`IProjectMatch.framework`). */
  readonly framework: string;
}
