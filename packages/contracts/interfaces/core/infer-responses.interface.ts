/**
 * Response inference dispatcher contract (audit 2026-09-06 §10,
 * proposal `f00012` S1).
 *
 * The implementation lives in
 * `packages/core/responses/infer-responses.ts`. The contract lives
 * here so exporters (Postman, OpenAPI, …) and MCP tools can name
 * the inputs without importing the dispatcher module.
 */
import type { IResponseRoute } from "./response-inferrer.interface.js";
import type { IFrameworkSourceFileLike } from "./responses.interface.js";
import type { IResponseFrameworkCoverage } from "./response-coverage.interface.js";

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
  /**
   * The route as the scanner saw it.
   *
   * When the caller has it, the inferrers get the **raw** URI (the
   * one written in the code, without the prefixes the scanner
   * applied) and the line of the declaration — which is what lets
   * them find their route in the file. When it is absent the
   * dispatcher falls back to the endpoint projection, which still
   * carries the method and the full URI.
   */
  readonly route?: IResponseRoute;
  /**
   * Reads another file of the same project, relative to its root.
   *
   * Rails and Laravel declare their routes in one file and their
   * responses in another, so their inferrers need to read the
   * controller. The dispatcher owns the I/O and passes the resolver
   * down; an inferrer stays a pure function of the text it reads.
   */
  readonly readSource?: (
    relativePath: string,
  ) => IFrameworkSourceFileLike | null;
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
  readonly rawUri?: string | null;
  readonly sourceFile?: string | null;
  readonly lineNumber?: number | null;
  readonly framework?: string | null;
  readonly controllerClass?: string | null;
  readonly actionName?: string | null;
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
  /**
   * How many operations each framework declared, and how many of them
   * ended up with a response.
   *
   * The coverage reporter turns this into percentages. It is part of
   * the result because the dispatcher is the only place that sees
   * every operation — the reporter would have to walk the specs
   * again to know the denominator.
   */
  readonly coverage: ReadonlyArray<IResponseFrameworkCoverage>;
}
