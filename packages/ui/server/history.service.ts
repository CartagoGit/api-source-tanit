/**
 * El historial de generaciones: append y lectura.
 *
 * Cada vez que `generate` o `summary` termina bien, deja una línea en
 * `~/.tanit/history.jsonl`. La interfaz la lee al abrir el
 * dashboard, y el comando `history` la imprime entera o filtrada.
 *
 * ## Por qué append y no reescritura del fichero
 *
 * Reescribir el fichero entero en cada generación obliga a leerlo
 * primero, lo que es un cliente del doble de caro (es I/O síncrono en
 * el path crítico) y abre una ventana en la que dos procesos —el
 * `watch` y la interfaz, por ejemplo— pueden pisarse el uno al otro.
 *
 * El append se hace con `writeFileAtomic` sobre un temporal + rename
 * solo cuando se construye una línea nueva. La escritura de cada línea
 * es atómica con respecto al lector: o se ve entera o no se ve. Si dos
 * procesos escriben a la vez, cada uno renombra su propio temporal y
 * el lector ve uno u otro, no una mezcla.
 *
 * ## Por qué líneas malas no tiran la lectura
 *
 * El fichero lo escribe el propio programa, pero también lo podría
 * editar una persona con un editor de texto: una coma fuera de sitio,
 * y la línea entera queda inválida. Descartar **todo** el historial
 * por una línea rota es desproporcionado — se ignora esa línea, se
 * dice en la respuesta cuántas se descartaron, y se sigue.
 */

import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { appendFileAtomic } from "../../core/helpers/atomic-write.helper.js";
import { parseJson } from "../../core/helpers/parse-json.helper.js";
import type {
  IHistoryAppendResult,
  IHistoryEntry,
  IHistoryEntryInput,
  IHistoryReadOptions,
  IHistoryReadResult,
} from "../../contracts/interfaces/cli/history.interface.js";
import type { IProjectSummary } from "../../contracts/interfaces/core/domain.interface.js";
import { HISTORY_DIR_MODE, HISTORY_ENTRY_VERSION } from "../../contracts/constants/cli/history.constant.js";

import {
  historyPath,
  userHistoryDir,
} from "../history-paths.helper.js";

/**
 * Construye una entrada lista para serializar.
 *
 * `timestamp` se calcula aquí y no en el llamador para que sea siempre
 * la del momento del append: dejar que el llamador la pase abre la
 * puerta a timestamps congelados (tests con `Date.now` mockeado,
 * reintentos con timestamp viejo).
 */
function buildEntry(
  input: IHistoryEntryInput,
  timestamp: Date,
): IHistoryEntry {
  const summary: IProjectSummary = input.summary;
  return {
    timestamp: timestamp.toISOString(),
    kind: input.kind,
    projectRoot: input.projectRoot,
    projectName: summary.projectName,
    framework: summary.framework,
    endpoints:
      input.kind === "generate"
        ? summary.routesInCode
        : summary.routesInCode,
    collectionPath:
      input.kind === "generate"
        ? (input.collectionPath ?? null)
        : null,
    summary,
  };
}

/**
 * Resultado de un append, sea exitoso o no.
 *
 * Los errores no se lanzan: `summary.script.ts` y `generate.script.ts`
 * llaman a esta función en su camino feliz, y un fallo de escritura
 * del historial no debe tumbar una generación que ya escribió su
 * colección. Se devuelve `{ ok: false, reason }` y quien llamó decide
 * si lo dice o se lo calla (en el CLI, lo segundo; en la UI, lo
 * primero, porque el usuario sí está mirando).
 *
 * El tipo vive en `contracts/interfaces/cli/history.interface.ts` —
 * no aquí. Un tipo declarado al lado de la función que lo estrenó
 * obliga a importar esa función para usarlo, y `history.script.ts` lo
 * necesita sin tener que importar el servicio entero.
 */
export type { IHistoryAppendResult } from "../../contracts/interfaces/cli/history.interface.js";

/**
 * Añade una entrada al historial.
 *
 * Si el directorio no existe, lo crea con `HISTORY_DIR_MODE`. Si la
 * escritura falla, devuelve `{ ok: false, reason }` y no lanza: el
 * llamador está en hot path.
 */
export async function appendHistory(
  input: IHistoryEntryInput,
  path: string = historyPath(),
  now: Date = new Date(),
): Promise<IHistoryAppendResult> {
  try {
    await mkdir(dirname(path), { recursive: true, mode: HISTORY_DIR_MODE });
    const entry = buildEntry(input, now);
    const linea = `${JSON.stringify({ version: HISTORY_ENTRY_VERSION, ...entry })}\n`;
    await appendFileAtomic(path, linea);
    return { ok: true, path };
  } catch (error) {
    return {
      ok: false,
      path,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * ¿Es esto una entrada de historial bien formada?
 *
 * Comprueba solo la forma —los campos obligatorios y sus tipos— y deja
 * la validación semántica para quien use la entrada. El historial se
 * serializa a JSONL con `JSON.stringify`, así que cualquier objeto que
 * haya pasado por ahí tiene las claves que se le pusieron; lo único
 * que puede venir mal es una edición manual.
 */
function isHistoryEntry(value: unknown): value is IHistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["timestamp"] === "string" &&
    (v["kind"] === "generate" || v["kind"] === "summary") &&
    typeof v["projectRoot"] === "string" &&
    typeof v["projectName"] === "string" &&
    typeof v["framework"] === "string" &&
    typeof v["endpoints"] === "number" &&
    (v["collectionPath"] === null || typeof v["collectionPath"] === "string") &&
    typeof v["summary"] === "object" &&
    v["summary"] !== null
  );
}

/**
 * Lee el historial y devuelve las entradas pedidas.
 *
 * `limit` recorta por la cola (las más recientes), no por la cabeza:
 * un historial que ya pasó de las N entradas enseñaría siempre las
 * mismas primeras, y eso es lo contrario de lo que un dashboard quiere.
 *
 * Las líneas que no parsean o no pasan `isHistoryEntry` se devuelven en
 * `rejected` con su número de línea (1-indexed, que es lo que un
 * editor enseña). El fichero puede ser legítimo y aun así tener una
 * línea mala; eso no impide devolver el resto.
 */
export async function readHistory(
  options: IHistoryReadOptions = {},
  path: string = historyPath(),
): Promise<IHistoryReadResult> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    // No hay fichero: no es un error, es que nadie ha generado todavía.
    // Se devuelve un resultado vacío y `rejected` también vacío para
    // que la UI enseñe "todavía nada" sin tener que distinguir.
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") {
      return { ok: true, entries: [], rejected: [], totalEntries: 0 };
    }
    throw error;
  }

  const todas: IHistoryEntry[] = [];
  const rechazadas: Array<{ line: number; reason: string }> = [];
  const lineas = raw.split("\n");

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i] ?? "";
    const numero = i + 1;
    const trimmed = linea.trim();
    if (trimmed === "") continue;
    const parsed = parseJson(trimmed);
    if (!parsed.ok) {
      rechazadas.push({ line: numero, reason: parsed.reason });
      continue;
    }
    if (!isHistoryEntry(parsed.value)) {
      rechazadas.push({ line: numero, reason: "the line is not a valid history entry" });
      continue;
    }
    todas.push(parsed.value);
  }

  // Más recientes primero: `timestamp` es ISO 8601, así que el orden
  // lexicográfico y el cronológico coinciden. `Array.prototype.sort`
  // es estable en V8 desde 2018, así que dos entradas con el mismo
  // timestamp conservan su orden de inserción.
  todas.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));

  let filtradas = todas;
  if (options.projectRoot !== undefined) {
    filtradas = filtradas.filter((e) => e.projectRoot === options.projectRoot);
  }

  const total = filtradas.length;
  const limitadas =
    options.limit !== undefined && options.limit > 0
      ? filtradas.slice(0, options.limit)
      : filtradas;

  return {
    ok: true,
    entries: limitadas,
    rejected: rechazadas,
    totalEntries: total,
  };
}

/** Vuelca una lista de entradas como texto JSONL, una por línea. */
export function formatHistoryJsonl(
  entries: ReadonlyArray<IHistoryEntry>,
): string {
  return entries.map((e) => JSON.stringify({ version: HISTORY_ENTRY_VERSION, ...e })).join("\n");
}

/**
 * Borra el historial completo.
 *
 * Devuelve `false` si el fichero no existía: borrarlo dos veces no es
 * un error. Lo usa el comando `history --clear`, y la UI nunca debería
 * llamarlo.
 */
export async function clearHistory(
  path: string = historyPath(),
): Promise<boolean> {
  const { unlink } = await import("node:fs/promises");
  try {
    await unlink(path);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return false;
    throw error;
  }
}

/** Re-export para los tests que prefieran construir la ruta a mano. */
export { historyPath, userHistoryDir };
