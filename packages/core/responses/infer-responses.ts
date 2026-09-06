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
 * Run every registered inferrer against `spec`/`source`,
 * concatenate and dedupe the entries, sort stably. The result
 * is the array that will land in `EndpointSpec.responses`.
 *
 * Fail-soft: a thrown inferrer logs a warning (via
 * `console.warn`) and is otherwise invisible. We never bubble
 * errors out of here; that would block generation on a single
 * malformed handler.
 */
export function inferResponses(
  spec: EndpointSpecLike,
  source: IFrameworkSourceFileLike,
): ReadonlyArray<IResponseInference> {
  const out: IResponseInference[] = [];
  for (const inf of inferrers) {
    if (inf.framework !== source.framework) continue;
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
