#!/usr/bin/env bun
/**
 * `history` script.
 *
 * Lists the most recent generations and inspections, sorted from most
 * recent to oldest. It is the inverse of the `summary` and `generate`
 * scripts that record entries: without something reading `history.jsonl`,
 * that file would fill up without anyone ever looking at it.
 *
 * The default format is text with one line per entry (project,
 * framework, endpoints, date). `--json` dumps the entries as JSONL,
 * exactly as they are on disk, ready to be piped into `jq` or another
 * tool.
 *
 * Usage:
 *   bun scripts/history.script.ts [--limit N] [--project <root>] [--json] [--clear]
 *   apisrc history [--limit N] [--project <root>] [--json] [--clear]
 */
import { hasFlag, readFlag } from "../../core/helpers/argv.helper.js";
import {
  clearHistory,
  formatHistoryJsonl,
  readHistory,
} from "../../ui/server/history.service.js";
import { historyPath } from "../../ui/history-paths.helper.js";
import type {
  IHistoryEntry,
  IHistoryOutcome,
  IRunHistoryOptions,
} from "../../contracts/interfaces/cli/history.interface.js";

function formatEntry(entry: IHistoryEntry, anchoProyecto = 24): string {
  const fecha = entry.timestamp.replace("T", " ").slice(0, 19);
  const verb = entry.kind === "generate" ? "generated" : "summarised";
  const cols = entry.projectName.padEnd(anchoProyecto);
  const fw = entry.framework.padEnd(10);
  return `${fecha}  ${verb.padEnd(11)} ${cols} ${fw} ${String(entry.endpoints).padStart(4)} endpoints`;
}

/**
 * Decides the project column width based on the longest entry in the
 * batch. Without this, a project with a 30-character name overflows the
 * column and the next entry looks like part of the name.
 */
function anchoProyectoOptimo(entries: ReadonlyArray<IHistoryEntry>): number {
  if (entries.length === 0) return 24;
  let max = 0;
  for (const e of entries) {
    if (e.projectName.length > max) max = e.projectName.length;
  }
  return Math.min(Math.max(max, 12), 40);
}

function asText(
  entries: ReadonlyArray<IHistoryEntry>,
  totalEntries: number,
  rejected: ReadonlyArray<{ line: number; reason: string }>,
  home: string,
): string {
  if (entries.length === 0) {
    const donde = `${home}/.tanit/history.jsonl`;
    if (totalEntries === 0) {
      return `No history yet. The first successful generate or summary will appear here.\n  · ${donde}`;
    }
    return `No history matches the filter.\n  · ${donde}`;
  }
  const ancho = anchoProyectoOptimo(entries);
  const lines: string[] = [];
  lines.push(`→ ${entries.length} of ${totalEntries} entries (most recent first):`);
  lines.push("");
  for (const entry of entries) lines.push(formatEntry(entry, ancho));
  if (rejected.length > 0) {
    lines.push("");
    lines.push(`⚠ ${rejected.length} corrupted line(s) ignored:`);
    for (const r of rejected.slice(0, 5)) {
      lines.push(`  · line ${r.line}: ${r.reason}`);
    }
    if (rejected.length > 5) lines.push(`  · … and ${rejected.length - 5} more`);
  }
  return lines.join("\n");
}

/**
 * Reads and shows the history.
 *
 * `argv` and `options` are injected so that `tests/cli/history.spec.ts`
 * can exercise the command without touching the system: `--limit`,
 * `--project`, `--json`, and `--clear` are read right here.
 *
 * The history path is computed from `options.historyPath` or, failing
 * that, `options.home`. With neither, it falls back to `historyPath()`
 * (which uses `process.env.HOME` by convention). The latter is what
 * `main()` does for production; tests always pass a concrete path
 * so they do not write to whoever runs the suite's `~/.tanit/`.
 */
export async function runHistory(
  argv: string[] = process.argv.slice(2),
  options: IRunHistoryOptions = {},
): Promise<IHistoryOutcome> {
  const filePath =
    options.historyPath ??
    (options.home !== undefined
      ? historyPath({}, process.platform, options.home)
      : historyPath());
  const homeRecord = options.home ?? process.env["HOME"] ?? "";

  if (hasFlag(argv, "--clear")) {
    try {
      const removed = await clearHistory(filePath);
      return {
        code: 0,
        output: removed
          ? "History cleared."
          : "Nothing to clear: the history file did not exist.",
      };
    } catch (error) {
      return {
        code: 1,
        output: `Could not clear history: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const limitText = readFlag(argv, "--limit");
  const limitParsed = limitText !== undefined ? Number(limitText) : undefined;
  if (limitParsed !== undefined && (!Number.isInteger(limitParsed) || limitParsed < 1)) {
    return {
      code: 1,
      output: "`--limit` expects a positive integer.",
    };
  }
  const projectRoot = readFlag(argv, "--project");
  const jsonMode = hasFlag(argv, "--json");

  try {
    const result = await readHistory({
      ...(limitParsed !== undefined ? { limit: limitParsed } : {}),
      ...(projectRoot !== undefined ? { projectRoot } : {}),
    }, filePath);

    if (jsonMode) {
      const salida = result.entries.length === 0
        ? ""
        : `${formatHistoryJsonl(result.entries)}\n`;
      return { code: 0, output: salida };
    }
    return { code: 0, output: asText(result.entries, result.totalEntries, result.rejected, homeRecord) };
  } catch (error) {
    return {
      code: 1,
      output: `Could not read history: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** The wrapper used by the CLI: prints the output and returns the code. */
export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  const outcome = await runHistory(argv);
  if (outcome.output !== "") {
    process.stdout.write(`${outcome.output}\n`);
  }
  return outcome.code;
}

if (import.meta.main) {
  process.exit(await main());
}

// Re-export para los tests que prefieran la ruta de disco.
export { historyPath };
