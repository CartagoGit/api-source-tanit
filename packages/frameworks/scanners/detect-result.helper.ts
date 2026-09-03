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
  return { score, evidence: [] };
}

/** Construye un resultado con una o varias señales. */
export function withEvidence(
  score: number,
  evidence: ReadonlyArray<IProjectDetectionEvidence>,
): IProjectScannerResult {
  return { score, evidence };
}
