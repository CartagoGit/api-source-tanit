/**
 * Generation history: append and read.
 *
 * Every time `generate` or `summary` finishes cleanly, it leaves a
 * line in `~/.tanit/history.jsonl`. The interface reads it when
 * opening the dashboard, and the `history` command prints it whole
 * or filtered.
 *
 * ## Why append and not rewriting the file
 *
 * Rewriting the whole file on every generation forces reading it
 * first, which is twice as costly (synchronous I/O on the critical
 * path) and opens a window where two processes — the `watch` and
 * the interface, for example — can trample each other.
 *
 * The append uses `writeFileAtomic` on a tmp + rename, only when a
 * new line is built. Each line's write is atomic with respect to the
 * reader: either you see it whole or you do not see it. If two
 * processes write at once, each renames its own tmp and the reader
 * sees one or the other, not a mix.
 *
 * ## Why bad lines do not kill the read
 *
 * The file is written by the program itself, but it can also be
 * edited by a person in a text editor: one stray comma, and the
 * whole line becomes invalid. Discarding **all** the history for one
 * broken line is disproportionate — we ignore that line, tell the
 * response how many were discarded, and move on.
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
 * Builds an entry ready to serialise.
 *
 * `timestamp` is computed here and not by the caller, so it is
 * always the moment of the append: letting the caller pass it
 * opens the door to frozen timestamps (tests with mocked `Date.now`,
 * retries with a stale timestamp).
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
 * Result of an append, success or failure.
 *
 * Errors are not thrown: `summary.script.ts` and `generate.script.ts`
 * call this function on their happy path, and a history-write failure
 * must not take down a generation that already wrote its collection.
 * We return `{ ok: false, reason }` and let the caller decide whether
 * to say it (the CLI stays silent; the UI says it, because the user
 * is looking).
 *
 * The type lives in `contracts/interfaces/cli/history.interface.ts`
 * — not here. A type declared next to the function that first used
 * it forces importing that function to use it, and `history.script.ts`
 * needs it without having to import the whole service.
 */
export type { IHistoryAppendResult } from "../../contracts/interfaces/cli/history.interface.js";

/**
 * Appends an entry to the history.
 *
 * If the directory does not exist, it is created with
 * `HISTORY_DIR_MODE`. If the write fails, it returns
 * `{ ok: false, reason }` and does not throw: the caller is on the
 * hot path.
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
 * Is this a well-formed history entry?
 *
 * It only checks shape — the required fields and their types — and
 * leaves semantic validation to whoever uses the entry. The history
 * is serialised to JSONL with `JSON.stringify`, so any object that
 * went through it carries the keys it was given; the only thing
 * that can be wrong is a manual edit.
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
export async function readHistory(
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

/** Dumps a list of entries as JSONL text, one per line. */
export function formatHistoryJsonl(
  entries: ReadonlyArray<IHistoryEntry>,
): string {
  return entries.map((e) => JSON.stringify({ version: HISTORY_ENTRY_VERSION, ...e })).join("\n");
}

/**
 * Clears the entire history.
 *
 * Returns `false` if the file did not exist: deleting it twice is
 * not an error. Used by the `history --clear` command; the UI
 * should never call it.
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

/** Re-export for tests that prefer to build the path by hand. */
export { historyPath, userHistoryDir };
