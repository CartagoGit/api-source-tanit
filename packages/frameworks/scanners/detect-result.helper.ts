/**
 * Helper so detectors return the `{ score, evidence }` shape the
 * orchestrator (and the UI) expect.
 *
 * Every detector goes through here today: `emptyResult(score)` when
 * the signal is unique or we haven't enriched the detector yet,
 * `withEvidence(...)` when we want to annotate one or more concrete
 * signals. Migrating a detector to evidence is just swapping
 * `return score` for `return withEvidence(score, [ { signal, weight } ])`,
 * without touching the rest of the logic.
 *
 * It is a helper (not a contract) because scanners already are the
 * contracts: adding another export here and keeping
 * `IProjectScannerResult` in `contracts/interfaces` keeps the
 * orchestrator's contract from leaking to those who don't need it.
 */
import type {
  IProjectDetectionEvidence,
  IProjectScannerResult,
} from "../../contracts/interfaces/core/scanner.interface";

/** Builds an empty result (no evidence) — the default case. */
export function emptyResult(score: number): IProjectScannerResult {
  return { score: clampScore(score), evidence: [] };
}

/**
 * Normalises a score to the `[0, 1]` range the orchestrator (and the
 * UI) expect.
 *
 * Explicit rules —no delegation to `Math.max(0, Math.min(1, …))`—
 * so a test can pin every case without having to remember `Math`'s
 * default behaviour:
 *
 * - `NaN` → `0` (a detector returning NaN is a broken detector).
 * - `+Infinity` → `1`, `-Infinity` → `0` (the `<` and `>` checks
 *   already covered them, but the spec names them explicitly).
 * - `value < 0` → `0`, `value > 1` → `1`.
 * - otherwise → `value`.
 *
 * Centralised here (a00012 S2) so no scanner has to apply
 * `Math.min(…, 1)` by hand, and so evidence can carry weights outside
 * `[0, 1]` without propagating `NaN`/`±Infinity` to the final score.
 */
export function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value === Number.POSITIVE_INFINITY) return 1;
  if (value === Number.NEGATIVE_INFINITY) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Builds a result with one or more signals. */
export function withEvidence(
  score: number,
  evidence: ReadonlyArray<IProjectDetectionEvidence>,
): IProjectScannerResult {
  return { score: clampScore(score), evidence };
}
