/**
 * Helper para que los detectores devuelvan el `{ score, evidence }`
 * que el orquestador (y la UI) esperan.
 *
 * Hoy todos los detectores pasan por aquí: `emptyResult(score)` cuando
 * la señal es única o cuando todavía no hemos enriquecido el detector,
 * `withEvidence(...)` cuando queremos anotar una o varias señales
 * concretas. Migrar un detector a evidence es una substitución del
 * `return score` por `return withEvidence(score, [ { signal, weight } ])`,
 * sin tocar el resto de la lógica.
 *
 * Es helper (no contrato) porque los scanners ya son contratos: añadir
 * aquí un export más y mantener `IProjectScannerResult` en
 * `contracts/interfaces` evita arrastrar el contrato del orquestador a
 * quien no lo necesita.
 */
import type {
  IProjectDetectionEvidence,
  IProjectScannerResult,
} from "../../contracts/interfaces/core/scanner.interface";

/** Construye un resultado vacío (sin evidence) — el caso por defecto. */
export function emptyResult(score: number): IProjectScannerResult {
  return { score: clampScore(score), evidence: [] };
}

/**
 * Normaliza un score al rango `[0, 1]` que el orquestador (y la UI)
 * esperan.
 *
 * Reglas explícitas —no delegación a `Math.max(0, Math.min(1, …))`—
 * para que un test pueda fijar cada caso sin tener que recordar el
 * comportamiento por defecto de `Math`:
 *
 * - `NaN` → `0` (un detector que devuelve NaN es un detector roto).
 * - `+Infinity` → `1`, `-Infinity` → `0` (los el `<` y `>` los cubrían
 *   ya, pero la spec los nombra explícitamente).
 * - `value < 0` → `0`, `value > 1` → `1`.
 * - resto → `value`.
 *
 * Centralizado aquí (a00012 S2) para que ningún scanner tenga que
 * aplicar `Math.min(…, 1)` a mano, y para que la evidencia pueda llevar
 * pesos fuera de `[0, 1]` sin propagar `NaN`/`±Infinity` al score
 * final.
 */
export function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value === Number.POSITIVE_INFINITY) return 1;
  if (value === Number.NEGATIVE_INFINITY) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Construye un resultado con una o varias señales. */
export function withEvidence(
  score: number,
  evidence: ReadonlyArray<IProjectDetectionEvidence>,
): IProjectScannerResult {
  return { score: clampScore(score), evidence };
}
