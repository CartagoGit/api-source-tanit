import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "../helpers/atomic-write.helper.js";
import { projectHistoryDirectory, historyPath } from "./history-paths.helper.js";
import { isHistoryEntry, readLegacyHistory } from "./legacy-history.helper.js";
import type { IHistoryEntry } from "../../contracts/interfaces/cli/history.interface.js";

/** Persist metadata honestly when no restorable source snapshot was recorded. */
export async function writeHistoryRun(entry: IHistoryEntry, directory: string, identity?: string, legacy = false): Promise<string> {
  const digest = createHash("sha256").update(identity ?? JSON.stringify(entry)).digest("hex");
  const folder = projectHistoryDirectory(entry.projectRoot, directory);
  await mkdir(folder, { recursive: true });
  const path = join(folder, `run-${digest}.json`);
  await writeJsonAtomic(path, { version: 2, entry, legacy });
  return path;
}

/** Read only run documents; revision documents remain owned by ProjectHistoryService. */
export async function storedHistoryRuns(directory: string, projectRoot?: string): Promise<ReadonlyArray<{ id: string; entry: IHistoryEntry; legacy: boolean }>> {
  const folders = projectRoot ? [projectHistoryDirectory(projectRoot, directory)] : (await names(directory)).map(name => join(directory, name));
  const entries: Array<{ id: string; entry: IHistoryEntry; legacy: boolean }> = [];
  for (const folder of folders) for (const name of await names(folder)) {
    if (!/^run-[a-f0-9]+\.json$/.test(name)) continue;
    try {
      const document = JSON.parse(await readFile(join(folder, name), "utf8")) as { version?: number; entry?: unknown; legacy?: boolean };
      if (document.version === 2 && isHistoryEntry(document.entry)) entries.push({ id: name.slice(0, -5), entry: document.entry, legacy: document.legacy === true });
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
  }
  return entries;
}

async function names(path: string): Promise<string[]> {
  try { return await readdir(path); }
  catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
}

/** Idempotent import keeps the original JSONL intact and never fabricates snapshots. */
export async function migrateLegacyHistory(directory: string, path = historyPath()): Promise<Awaited<ReturnType<typeof readLegacyHistory>>> {
  let signature: string;
  try { const info = await stat(path); signature = `${info.size}:${info.mtimeMs}`; }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return { ok: true, entries: [], rejected: [], totalEntries: 0 }; throw error; }
  const receiptPath = join(directory, `legacy-import-${createHash("sha256").update(path).digest("hex")}.json`);
  try {
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { signature?: string; rejected?: Array<{ line: number; reason: string }> };
    if (receipt.signature === signature && Array.isArray(receipt.rejected)) return { ok: true, entries: [], rejected: receipt.rejected, totalEntries: 0 };
  } catch (error) { if ((error as { code?: string }).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  const result = await readLegacyHistory({}, path);
  const occurrences = new Map<string, number>();
  for (const entry of result.entries) {
    // Stable input order preserves identical historical entries as separate runs.
    const serialized = JSON.stringify(entry);
    const occurrence = occurrences.get(serialized) ?? 0;
    occurrences.set(serialized, occurrence + 1);
    const identity = `${path}\n${occurrence}\n${serialized}`;
    const digest = createHash("sha256").update(identity).digest("hex");
    const target = join(projectHistoryDirectory(entry.projectRoot, directory), `run-${digest}.json`);
    try { await readFile(target, "utf8"); }
    catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
      await writeHistoryRun(entry, directory, identity, true);
    }
  }
  await mkdir(directory, { recursive: true });
  await writeJsonAtomic(receiptPath, { signature, rejected: result.rejected });
  return result;
}
