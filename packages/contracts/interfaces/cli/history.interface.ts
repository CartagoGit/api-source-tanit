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
 * What is passed to the service when something finishes.
 *
 * Splitting `kind` from the rest of the input is necessary because
 * `summary` does not produce a collection: the other fields are
 * filled the same way but `collectionPath` stays `null` and
 * `endpoints` carries the summary count (which is no longer the
 * collection).
 */
export interface IHistoryEntryInput {
  readonly kind: "generate" | "summary";
  readonly projectRoot: string;
  readonly summary: IProjectSummary;
  /** Only when `kind === "generate"`. */
  readonly collectionPath?: string | null;
}

/**
 * How the UI reads the history.
 *
 * The full file is not returned: a project regenerated on every
 * file change accumulates thousands of entries, and the UI only
 * shows the latest N.
 */
export interface IHistoryReadOptions {
  /** How many to return, starting with the most recent. */
  readonly limit?: number;
  /** Filter by exact project (root). `undefined` = all. */
  readonly projectRoot?: string;
}

/** Result of reading the history. */
export interface IHistoryReadResult {
  readonly ok: true;
  /** Entries, newest first, already limited. */
  readonly entries: ReadonlyArray<IHistoryEntry>;
  /** Lines that couldn't be parsed. */
  readonly rejected: ReadonlyArray<{ readonly line: number; readonly reason: string }>;
  /** Total valid lines, before applying `limit`. */
  readonly totalEntries: number;
}

/**
 * Result of `appendHistory`.
 *
 * Errors are not thrown: `summary.script.ts` and `generate.script.ts`
 * call this function on their happy path, and a write failure
 * to the history must not bring down a generation that already
 * wrote its collection. Return `{ ok: false, reason }` and let
 * the caller decide whether to surface it (CLI: no; UI: yes —
 * because the user IS looking).
 */
export interface IHistoryAppendResult {
  readonly ok: boolean;
  readonly path: string;
  readonly reason?: string;
}

/** What `runHistory` returns: exit code and text for stdout. */
export interface IHistoryOutcome {
  readonly code: 0 | 1;
  readonly output: string;
}

/** Optional arguments to `runHistory`, in a single object. */
export interface IRunHistoryOptions {
  /** Absolute path to the history file. Falls back to `historyPath()`. */
  readonly historyPath?: string;
  /** HOME to resolve `historyPath()`. Only if `historyPath` is not given. */
  readonly home?: string;
}
