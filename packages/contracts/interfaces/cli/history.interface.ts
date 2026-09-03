/**
 * El historial de generaciones que ve el dashboard.
 *
 * Es el registro mínimo de cada `generate`/`summary` que salió bien:
 * cuándo, dónde y qué. Sin él el dashboard no tiene qué enseñar; con
 * él, basta con abrir la interfaz para ver qué proyecto se generó
 * último, y desde cuándo no se toca uno que debería tocarse.
 *
 * ## Por qué JSONL y no un array JSON
 *
 * Cada `generate` añade **una** línea al final. Con un JSON array, dos
 * generaciones concurrentes —la interfaz y un `watch`, por ejemplo—
 * competirían por leer-modificar-escribir el mismo fichero, y el que
 * perdiera tiraría los cambios del otro. JSONL permite append atómico
 * por líneas: o se ve la entrada entera o no se ve, y dos escrituras a
 * la vez no se pisan porque `writeFileAtomic` no entra en juego.
 *
 * Una línea corrupta se ignora y se dice — se ignora porque el fichero
 * lo escribió otro programa y una errata no puede tumbar la lectura;
 * se dice porque si alguien editó a mano y rompió algo, debe verlo.
 */

import type { IProjectSummary } from "../core/domain.interface.js";

/**
 * Una entrada del historial: una generación (o inspección) cerrada.
 *
 * Las claves son cortas porque esto se serializa a JSONL: cada byte
 * extra multiplica por N entradas. Los nombres largos viven en
 * `IProjectSummary` (que es el campo `summary`).
 */
export interface IHistoryEntry {
  /** ISO 8601 con desplazamiento. Estable: ordenable lexicográficamente. */
  readonly timestamp: string;
  /** `"generate"` o `"summary"` — qué terminó. */
  readonly kind: "generate" | "summary";
  /** Raíz absoluta del proyecto del que se leyó. */
  readonly projectRoot: string;
  /** Nombre del proyecto, para enseñar sin tener que leer la raíz. */
  readonly projectName: string;
  /** Framework ganador, del que `generate` sacó la colección. */
  readonly framework: string;
  /** Endpoints que produjo, o `0` para `summary`. */
  readonly endpoints: number;
  /** Ruta de la colección escrita, o `null` si fue `summary`. */
  readonly collectionPath: string | null;
  /**
   * El resumen entero, para que la UI pinte el detalle sin reescanear.
   *
   * Llevarlo aquí encarece cada entrada (es el grueso del JSONL) y es
   * exactamente el precio que se paga por abrir el dashboard y no
   * tener que volver al proyecto. Sin él, un dashboard histórico es un
   * listado de marcos vacíos.
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
