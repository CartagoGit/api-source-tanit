/**
 * Response inference dispatcher contract (audit 2026-09-06 §10,
 * proposal `f00012` S1).
 *
 * The implementation lives in
 * `packages/core/responses/infer-responses.ts`. The contract lives
 * here so exporters (Postman, OpenAPI, …) and MCP tools can name
 * the inputs without importing the dispatcher module.
 */

/**
 * Optional overrides for `inferResponses()`.
 *
 * - `frameworkHint`: lets the caller override the framework used to
 *   select which inferrer runs. Used by `x00061` to dispatch on the
 *   per-spec framework (e.g. a NestJS+FastAPI hybrid project where
 *   the global `pipeline.match?.framework` is the winner and a FastAPI
 *   endpoint would otherwise get the NestJS inferrer by mistake).
 *   When omitted, falls back to `source.framework`.
 */
export interface InferResponsesOptions {
  readonly frameworkHint?: string;
}

/**
 * Per-route metadata used by `inferResponsesIntoSpecs` to dispatch
 * the right framework inferrer and read the right source file. We
 * accept the bare projection here so the function does not have to
 * depend on `IProjectMatch` (which lives in the scanner contract).
 */
export interface IRouteForInference {
  readonly method: string;
  readonly uri: string;
  readonly sourceFile?: string | null;
  readonly framework?: string | null;
}

/**
 * Pipeline return shape. Mutates the specs in place; the summary
 * is what callers show back to the user.
 */
export interface IInferResponsesIntoSpecsResult {
  /** How many specs ended up with at least one inferred entry. */
  readonly enrichedCount: number;
  /**
   * True when the dispatcher registry had zero inferrers at the
   * time of the call. Production calls `inferResponsesIntoSpecs()`
   * after `ensureResponseInferrersRegistered()`; tests may pass an
   * empty registry intentionally.
   */
  readonly registryEmpty: boolean;
}
