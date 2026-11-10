/** The shared history authority; JSONL is a read-only migration input. */
import { dirname, join } from "node:path";
import { readdir, unlink } from "node:fs/promises";
import { historyPath, userHistoryDir } from "./history-paths.helper.js";
import { ProjectHistoryService, resolveHistoryDirectory } from "./project-history.service.js";
import { migrateLegacyHistory, writeHistoryRun } from "./history-run.repository.js";
import { HISTORY_ENTRY_VERSION } from "../../contracts/constants/cli/history.constant.js";
import type { IHistoryAppendResult, IHistoryEntry, IHistoryEntryInput, IHistoryReadOptions, IHistoryReadResult } from "../../contracts/interfaces/cli/history.interface.js";

/** An injected legacy path also isolates its target repository for tests/tools. */
export function historyDirectoryFor(path?: string): string {
  if (path && /(?:^|[\\/])run-[a-f0-9]+\.json$/.test(path)) return dirname(dirname(path));
  return path === undefined || path === historyPath() ? resolveHistoryDirectory() : `${path}.records`;
}

/** Persist completed run metadata; full snapshot revisions use ProjectHistoryService.record. */
export async function appendHistory(input: IHistoryEntryInput, path?: string, now = new Date()): Promise<IHistoryAppendResult> {
  const directory = historyDirectoryFor(path);
  try {
    const entry: IHistoryEntry = { timestamp: now.toISOString(), kind: input.kind, projectRoot: input.projectRoot,
      projectName: input.summary.projectName, framework: input.summary.framework, endpoints: input.summary.routesInCode,
      collectionPath: input.kind === "generate" ? input.collectionPath ?? null : null, summary: input.summary };
    return { ok: true, path: await writeHistoryRun(entry, directory) };
  } catch (error) { return { ok: false, path: directory, reason: error instanceof Error ? error.message : String(error) }; }
}

/** Read the shared history newest first, migrating legacy entries idempotently. */
export async function readHistory(options: IHistoryReadOptions = {}, path?: string): Promise<IHistoryReadResult> {
  const directory = historyDirectoryFor(path);
  const legacy = path && /(?:^|[\\/])run-[a-f0-9]+\.json$/.test(path)
    ? { rejected: [] } : await migrateLegacyHistory(directory, path);
  const entries = await new ProjectHistoryService({ directory }).runs(options.projectRoot);
  return { ok: true, entries: options.limit !== undefined && options.limit > 0 ? entries.slice(0, options.limit) : entries,
    rejected: legacy.rejected, totalEntries: entries.length };
}

/** Explicit user clear removes only repository-owned records and legacy input. */
export async function clearHistory(path?: string): Promise<boolean> {
  const directory = historyDirectoryFor(path);
  let removed = false;
  const remove = async (target: string): Promise<void> => {
    try { await unlink(target); removed = true; }
    catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; }
  };
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: { code?: string }) => {
    if (error.code === "ENOENT") return []; throw error;
  });
  for (const entry of entries) {
    if (entry.isFile() && /^legacy-import-[a-f0-9]{64}\.json$/.test(entry.name)) await remove(join(directory, entry.name));
    if (!entry.isDirectory() || !/^[a-f0-9]{16}$/.test(entry.name)) continue;
    const folder = join(directory, entry.name);
    for (const record of await readdir(folder, { withFileTypes: true })) {
      const owned = /^run-[a-f0-9]{64}\.json$/.test(record.name) || /^\d{4}-\d{2}-\d{2}T[\d._-]+Z-[a-f0-9]{12}(?:-[a-f0-9]{12})?\.json$/.test(record.name);
      if (record.isFile() && owned) await remove(join(folder, record.name));
    }
  }
  await remove(path ?? historyPath());
  return removed;
}

/** Produce legacy-compatible JSONL output from the shared record projection. */
export function formatHistoryJsonl(entries: ReadonlyArray<IHistoryEntry>): string {
  return entries.map(entry => JSON.stringify({ version: HISTORY_ENTRY_VERSION, ...entry })).join("\n");
}
export { historyPath, userHistoryDir };
