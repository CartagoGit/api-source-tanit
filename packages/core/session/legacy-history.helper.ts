/** Read-only compatibility importer. New writes use the common history store. */
import { readFile } from "node:fs/promises";
import { parseJson } from "../helpers/parse-json.helper.js";
import { historyPath } from "./history-paths.helper.js";
import type { IHistoryEntry, IHistoryReadOptions, IHistoryReadResult } from "../../contracts/interfaces/cli/history.interface.js";
export function isHistoryEntry(value: unknown): value is IHistoryEntry {
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
 * Reads the history and returns the requested entries.
 *
 * `limit` trims from the tail (the most recent), not from the head:
 * a history that already passed N entries would always show the same
 * first ones, which is the opposite of what a dashboard wants.
 *
 * Lines that fail to parse or to pass `isHistoryEntry` are returned
 * in `rejected` with their 1-indexed line number (which is what an
 * editor shows). The file can be legitimate and still have one bad
 * line; that does not prevent returning the rest.
 */
export async function readLegacyHistory(
  options: IHistoryReadOptions = {},
  path: string = historyPath(),
): Promise<IHistoryReadResult> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    // No file: not an error, just nobody has generated yet. We return
    // an empty result and an empty `rejected` so the UI shows
    // "nothing yet" without having to branch.
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

  // Most recent first: `timestamp` is ISO 8601, so lexicographic and
  // chronological order coincide. `Array.prototype.sort` has been
  // stable on V8 since 2018, so two entries with the same timestamp
  // keep their insertion order.
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

