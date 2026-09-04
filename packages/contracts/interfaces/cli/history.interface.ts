/**
 * The history of generations the dashboard shows.
 *
 * It is the minimum record of each `generate` / `summary` that
 * succeeded: when, where, and what. Without it the dashboard has
 * nothing to show; with it, opening the UI is enough to see what
 * project was generated last, and since when one that should have
 * been regenerated has not been.
 *
 * ## Why JSONL and not a JSON array
 *
 * Each `generate` appends **one** line at the end. With a JSON array,
 * two concurrent generations — the UI and a `watch`, say — would
 * compete to read-modify-write the same file, and the loser would
 * drop the winner's changes. JSONL allows atomic line-level
 * append: either the whole entry is visible or none of it is, and
 * two writes at the same time do not clobber each other because
 * `writeFileAtomic` doesn't enter the picture.
 *
 * A corrupted line is silently ignored and loudly reported —
 * ignored because the file was written by another program and a
 * typo cannot bring the read down; reported because if someone
 * edited by hand and broke something, they need to know.
 */

import type { IProjectSummary } from "../core/domain.interface.js";

/**
 * One history entry: a generation (or inspection) that completed.
 *
 * The keys are short because this is serialized to JSONL: every
 * extra byte multiplies by N entries. Long names live in
 * `IProjectSummary` (the `summary` field).
 */
export interface IHistoryEntry {
  /** ISO 8601 with offset. Stable: lexicographically sortable. */
  readonly timestamp: string;
  /** `"generate"` or `"summary"` — what finished. */
  readonly kind: "generate" | "summary";
  /** Absolute root of the project that was read. */
  readonly projectRoot: string;
  /** Project name, to show without re-reading the root. */
  readonly projectName: string;
  /** Winning framework, from which `generate` produced the collection. */
  readonly framework: string;
  /** Endpoints produced, or `0` for `summary`. */
  readonly endpoints: number;
  /** Path of the written collection, or `null` for `summary`. */
  readonly collectionPath: string | null;
  /**
   * The full summary, so the UI can render detail without rescanning.
   *
   * Including it costs per entry (it's the bulk of the JSONL) and
   * is exactly the price we pay for opening the dashboard and not
   * having to revisit the project. Without it, a historical
   * dashboard is a list of empty cards.
   */
  readonly summary: IProjectSummary;
}

/**
 * Lo que se le pasa al servicio cuando algo termina bien.
 *
 * Separa el `kind` del resto porque `summary` no genera colección: el
 * resto de campos se rellena igual pero `collectionPath` queda en
 * `null` y `endpoints` lleva el conteo del resumen (que ya no es la
 * colección).
 */
export interface IHistoryEntryInput {
  readonly kind: "generate" | "summary";
  readonly projectRoot: string;
  readonly summary: IProjectSummary;
  /** Solo si `kind === "generate"`. */
  readonly collectionPath?: string | null;
}

/**
 * Cómo se lee el historial en la UI.
 *
 * No se devuelve el fichero entero: un proyecto que se genera cada vez
 * que cambia un fichero acaba con miles de entradas, y la UI solo
 * enseña las últimas N.
 */
export interface IHistoryReadOptions {
  /** Cuántas devolver, empezando por la más reciente. */
  readonly limit?: number;
  /** Filtrar por proyecto exacto (raíz). `undefined` = todos. */
  readonly projectRoot?: string;
}

/** Resultado de leer el historial. */
export interface IHistoryReadResult {
  readonly ok: true;
  /** Entradas, de más reciente a más antigua, ya limitadas. */
  readonly entries: ReadonlyArray<IHistoryEntry>;
  /** Líneas que había en el fichero y no se pudieron parsear. */
  readonly rejected: ReadonlyArray<{ readonly line: number; readonly reason: string }>;
  /** Total de líneas válidas, antes de aplicar `limit`. */
  readonly totalEntries: number;
}

/**
 * Resultado de `appendHistory`.
 *
 * Los errores no se lanzan: `summary.script.ts` y `generate.script.ts`
 * llaman a esta función en su camino feliz, y un fallo de escritura
 * del historial no debe tumbar una generación que ya escribió su
 * colección. Se devuelve `{ ok: false, reason }` y quien llamó decide
 * si lo dice o se lo calla (en el CLI, lo segundo; en la UI, lo
 * primero, porque el usuario sí está mirando).
 */
export interface IHistoryAppendResult {
  readonly ok: boolean;
  readonly path: string;
  readonly reason?: string;
}

/** Lo que devuelve `runHistory`: código de salida y texto para stdout. */
export interface IHistoryOutcome {
  readonly code: 0 | 1;
  readonly output: string;
}

/** Argumentos opcionales de `runHistory`, en un solo objeto. */
export interface IRunHistoryOptions {
  /** Ruta absoluta al fichero de historial. Si falta, se calcula con `historyPath()`. */
  readonly historyPath?: string;
  /** HOME a usar para resolver `historyPath()`. Solo si no se pasa `historyPath`. */
  readonly home?: string;
}
