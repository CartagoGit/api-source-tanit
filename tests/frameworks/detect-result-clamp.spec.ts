/**
 * Tests for the centralized score clamp of the detectors
 * (a00012 S2).
 *
 * Before this slice, `withEvidence` returned the score as-is and every
 * scanner that could overshoot applied `Math.min(…, 1)` by hand. That
 * broke the contract when the sum of weights exceeded `1` (a Hono
 * with a lockfile summed `1 + 0.1 + 0.15 = 1.25`), and left the door
 * open for a future detector to introduce a `NaN` or `±Infinity`
 * without anything catching it.
 *
 * The clamp now lives in `clampScore` and `withEvidence` applies it
 * automatically. `evidence` is returned as-is: weights may fall
 * outside `[0, 1]` because they are descriptive signals, not
 * accumulators.
 *
 * `tsconfig.base.json` has `allowImportingTsExtensions: false`, so
 * the import goes without the `.ts` extension (same pattern as the
 * rest of `tests/frameworks/*.spec.ts`).
 */
import { describe, expect, test } from "vitest";

import {
  clampScore,
  withEvidence,
} from "../../packages/frameworks/scanners/detect-result.helper";

describe("clampScore", () => {
  test("NaN → 0", () => {
    expect(clampScore(Number.NaN)).toBe(0);
  });

  test("+Infinity → 1", () => {
    expect(clampScore(Number.POSITIVE_INFINITY)).toBe(1);
  });

  test("-Infinity → 0", () => {
    expect(clampScore(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  test("value < 0 → 0 (case -0.2)", () => {
    expect(clampScore(-0.2)).toBe(0);
  });

  test("value > 1 → 1 (case 1.25)", () => {
    expect(clampScore(1.25)).toBe(1);
  });

  test("value ∈ [0, 1] is preserved (cases 0 and 0.5)", () => {
    expect(clampScore(0.5)).toBe(0.5);
    expect(clampScore(0)).toBe(0);
  });
});

describe("withEvidence + clampScore", () => {
  test("the score goes through clampScore", () => {
    expect(withEvidence(1.25, []).score).toBe(1);
    expect(withEvidence(-0.2, []).score).toBe(0);
    expect(withEvidence(Number.NaN, []).score).toBe(0);
    expect(withEvidence(Number.POSITIVE_INFINITY, []).score).toBe(1);
    expect(withEvidence(Number.NEGATIVE_INFINITY, []).score).toBe(0);
    expect(withEvidence(0.5, []).score).toBe(0.5);
    expect(withEvidence(0, []).score).toBe(0);
  });

  test("evidence is returned as-is (out-of-range weights allowed)", () => {
    const evidence = [{ signal: "lockfile bonus inflado", weight: 2.5 }];
    const result = withEvidence(1.25, evidence);
    expect(result.score).toBe(1);
    expect(result.evidence[0]?.weight).toBe(2.5);
  });
});
