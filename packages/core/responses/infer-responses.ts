/**
 * Response inference dispatcher (audit 2026-09-06 §10, proposal
 * `f00012` S1).
 *
 * The dispatcher is the **single entry point** every exporter
 * (Postman, OpenAPI, ...) calls to ask the framework inferrers
 * what an endpoint returns. It loops over the registered
 * inferrers in `inferrers` (mutable for test injection), runs
 * each one with a `try / catch` shield (fail-soft per the
 * proposal), concatenates the entries, deduplicates by
 * `(status, reason)`, and sorts stably by
 * `(status asc, confidence desc)`.
 *
 * Empty inferrer registry is a valid state — `inferResponses()`
 * returns `[]` and the spec stays with no `responses` block.
 * That is the same behaviour as today (no inferrer exists yet).
 *
 * Convention — every framework scanner plugin adds
 * `registerResponseInferrer(new <Framework>ResponseInferrer())`
 * in its `init()`. The dispatcher is intentionally framework-
 * agnostic and does **not** auto-discover inferrers.
 */
import type {
  EndpointSpecLike,
  IFrameworkSourceFileLike,
  IResponseInference,
  IResponseInferrer,
  IResponseInferenceConfidence,
} from "../../contracts/interfaces/core/responses.interface.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ParsedRoute } from "../../contracts/interfaces/core/scanner.interface.js";

/**
 * Mutable, test-friendly registry. Production reads through
 * `registerResponseInferrer` (typically called from each
 * scanner's `init`); tests can clear and re-seed it via
 * `__setInferrersForTest`.
 */
const inferrers: IResponseInferrer[] = [];

/** Returns a frozen snapshot — safe to read, safe to log. */
export function listRegisteredInferrers(): ReadonlyArray<IResponseInferrer> {
  return Object.freeze([...inferrers]);
}

/**
 * Register an inferrer. No-op if an inferrer for the same
 * framework is already registered (last-write-wins would be a
 * recipe for accidental overwrites — explicit replace is what
 * tests want).
 */
export function registerResponseInferrer(
  inferrer: IResponseInferrer,
): void {
  const idx = inferrers.findIndex((i) => i.framework === inferrer.framework);
  if (idx >= 0) inferrers[idx] = inferrer;
  else inferrers.push(inferrer);
}

/**
 * Replace the entire registry — test-only escape hatch.
 *
 * Tests run `__setInferrersForTest([])` to start from a clean
 * state and call `registerResponseInferrer` to compose the
 * scenarios they want. Production code never uses this.
 */
export function __setInferrersForTest(
  list: ReadonlyArray<IResponseInferrer>,
): void {
  inferrers.length = 0;
  inferrers.push(...list);
}

const CONFIDENCE_ORDER: Record<IResponseInferenceConfidence, number> = {
  high: 2,
  medium: 1,
  low: 0,
};

function isValidEntry(e: IResponseInference): e is IResponseInference {
  return (
    typeof e.status === "number" &&
    typeof e.reason === "string" &&
    e.reason.length > 0 &&
    (e.confidence === "high" ||
      e.confidence === "medium" ||
      e.confidence === "low")
  );
}

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
  /** Force the dispatcher to pick the inferrer for this framework. */
  readonly frameworkHint?: string;
}

/**
 * Run every registered inferrer against `spec`/`source`,
 * concatenate and dedupe the entries, sort stably. The result
 * is the array that will land in `EndpointSpec.responses`.
 *
 * Fail-soft: a thrown inferrer logs a warning (via
 * `console.warn`) and is otherwise invisible. We never bubble
 * errors out of here; that would block generation on a single
 * malformed handler.
 *
 * Framework selection (x00061): the dispatcher picks the inferrer
 * whose `framework` matches `options.frameworkHint ?? source.framework`.
 * The hint lets the caller override the discriminator when the
 * source is from a hybrid project where `source.framework` may not
 * be the right signal (e.g. the source file is a generic
 * controller that the per-spec route originated from a different
 * framework).
 */
export function inferResponses(
  spec: EndpointSpecLike,
  source: IFrameworkSourceFileLike,
  options: InferResponsesOptions = {},
): ReadonlyArray<IResponseInference> {
  const framework = options.frameworkHint ?? source.framework;
  const out: IResponseInference[] = [];
  for (const inf of inferrers) {
    if (inf.framework !== framework) continue;
    let produced: ReadonlyArray<IResponseInference>;
    try {
      produced = inf.infer(spec, source);
    } catch (err) {
      console.warn(
        `[responses] inferrer for framework "${inf.framework}" threw:`,
        err,
      );
      continue;
    }
    for (const e of produced) {
      if (isValidEntry(e)) out.push(e);
    }
  }
  // dedupe by (status, reason) — first wins.
  const seen = new Set<string>();
  const deduped = out.filter((e) => {
    const k = `${e.status}::${e.reason}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Stable sort: status asc, confidence desc, then insertion order.
  deduped.sort((a, b) => {
    if (a.status !== b.status) return a.status - b.status;
    const diff = CONFIDENCE_ORDER[b.confidence] - CONFIDENCE_ORDER[a.confidence];
    if (diff !== 0) return diff;
    return out.indexOf(a) - out.indexOf(b);
  });
  return Object.freeze(deduped);
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
 * Pipeline entry point: run the dispatcher against every spec,
 * cache the source reads, and mutate `spec.responses` in place.
 * See `IInferResponsesIntoSpecsResult` for the return shape. The
 * CLI is the composition root that populates the inferrer
 * registry before calling the pipeline.
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

/**
 * Pipeline entry point: read every spec's source file, dispatch
 * the right framework inferrer, and write the entries onto
 * `spec.responses`. Mutating in place is intentional — every
 * downstream exporter (Postman, OpenAPI, Bruno, HAR) reads from
 * the same spec catalog and must see the same enriched data, so
 * producing a new array would only duplicate state.
 *
 * The function exists because the **only** place that should
 * mutate `EndpointSpec.responses` is the pipeline, not the
 * script. Before it landed, the CLI ran the inference loop after
 * `buildCollection()` had already serialised the Postman
 * collection, which meant the inferred `response[]` block never
 * made it into the JSON the user saw. See the `f00014` follow-up
 * for the full bug history.
 */
export async function inferResponsesIntoSpecs(
  specs: ReadonlyArray<EndpointSpecLike>,
  projectRoot: string,
  routes: ReadonlyArray<IRouteForInference>,
  options: {
    /**
     * Fallback framework when a route has no per-route
     * `framework` (e.g. a legacy scanner that doesn't tag the
     * ParsedRoute). Pass the global match winner here.
     */
    readonly globalFramework?: string;
  } = {},
): Promise<IInferResponsesIntoSpecsResult> {
  const registryEmpty = inferrers.length === 0;
  if (registryEmpty) {
    return { enrichedCount: 0, registryEmpty: true };
  }
  const globalFramework = options.globalFramework ?? "";
  // Pre-bucket routes by (METHOD uri) once. The key is identical to
  // the one used inside the loop so spec→route pairing does not
  // depend on ParsedRoute's exact casing — the dispatcher normalises
  // on its side.
  const routeByKey = new Map<string, IRouteForInference>();
  for (const r of routes) {
    routeByKey.set(`${r.method.toUpperCase()} ${r.uri}`, r);
  }
  const sourceCache = new Map<string, string>();
  let enriched = 0;
  for (const spec of specs) {
    const info = routeByKey.get(`${spec.method} ${spec.uri}`);
    const rel = info?.sourceFile ?? null;
    if (!rel) continue;
    let content = sourceCache.get(rel);
    if (content === undefined) {
      const abs = join(projectRoot, rel);
      try {
        content = await readFile(abs, "utf8");
      } catch {
        content = ""; // unreadable source → skip silently
      }
      sourceCache.set(rel, content);
    }
    if (!content) continue;
    const frameworkHint =
      info && info.framework && info.framework.length > 0
        ? info.framework
        : globalFramework;
    if (!frameworkHint) continue;
    let entries: ReadonlyArray<IResponseInference>;
    try {
      entries = inferResponses(
        spec,
        {
          path: join(projectRoot, rel),
          content,
          framework: frameworkHint,
        },
        { frameworkHint },
      );
    } catch (err) {
      console.warn(
        `[responses] inferrer for framework "${frameworkHint}" threw on ${spec.method} ${spec.uri}:`,
        err,
      );
      continue;
    }
    if (entries.length > 0) {
      // EndpointSpec is structurally compatible with EndpointSpecLike,
      // but TS doesn't narrow through the union — cast at the
      // assignment site to keep the helper usable for both shapes.
      (spec as { responses?: ReadonlyArray<IResponseInference> }).responses = entries;
      enriched++;
    }
  }
  return { enrichedCount: enriched, registryEmpty: false };
}

// Re-export so the pipeline does not have to chase the scanner type.
export type { ParsedRoute };
