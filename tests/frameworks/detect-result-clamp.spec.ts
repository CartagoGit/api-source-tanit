/**
 * Tests para el clamp centralizado del score de los detectores
 * (a00012 S2).
 *
 * Antes del slice, `withEvidence` devolvía el score tal cual y cada
 * scanner que podía pasarse aplicaba `Math.min(…, 1)` a mano. Eso
 * rompía el contrato cuando la suma de los pesos quedaba por encima
 * de `1` (un Hono con lockfile sumaba `1 + 0.1 + 0.15 = 1.25`), y
 * dejaba la puerta abierta a que un detector futuro introdujera un
 * `NaN` o un `±Infinity` sin que nada lo cazara.
 *
 * El clamp vive ahora en `clampScore` y `withEvidence` lo aplica
 * automáticamente. `evidence` se devuelve tal cual: los pesos pueden
 * estar fuera de `[0, 1]` porque son señales descriptivas, no
 * acumulados.
 *
 * `tsconfig.base.json` tiene `allowImportingTsExtensions: false`, por
 * lo que el import va sin la extensión `.ts` (mismo patrón que el
 * resto de `tests/frameworks/*.spec.ts`).
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

  test("value < 0 → 0 (caso -0.2)", () => {
    expect(clampScore(-0.2)).toBe(0);
  });

  test("value > 1 → 1 (caso 1.25)", () => {
    expect(clampScore(1.25)).toBe(1);
  });

  test("value ∈ [0, 1] se conserva (casos 0 y 0.5)", () => {
    expect(clampScore(0.5)).toBe(0.5);
    expect(clampScore(0)).toBe(0);
  });
});

describe("withEvidence + clampScore", () => {
  test("el score pasa por clampScore", () => {
    expect(withEvidence(1.25, []).score).toBe(1);
    expect(withEvidence(-0.2, []).score).toBe(0);
    expect(withEvidence(Number.NaN, []).score).toBe(0);
    expect(withEvidence(Number.POSITIVE_INFINITY, []).score).toBe(1);
    expect(withEvidence(Number.NEGATIVE_INFINITY, []).score).toBe(0);
    expect(withEvidence(0.5, []).score).toBe(0.5);
    expect(withEvidence(0, []).score).toBe(0);
  });

  test("evidence se devuelve tal cual (pesos fuera de rango permitidos)", () => {
    const evidence = [{ signal: "lockfile bonus inflado", weight: 2.5 }];
    const result = withEvidence(1.25, evidence);
    expect(result.score).toBe(1);
    expect(result.evidence[0]?.weight).toBe(2.5);
  });
});