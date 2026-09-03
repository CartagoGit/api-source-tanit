#!/usr/bin/env bun
/**
 * Script `history`.
 *
 * Lista las últimas generaciones e inspecciones, ordenadas de más
 * reciente a más antigua. Es el reverso del `summary` y `generate` que
 * registran: sin algo que lea `history.jsonl`, ese fichero se llenaría
 * sin que nadie lo mirara nunca.
 *
 * El formato por defecto es texto con una línea por entrada (proyecto,
 * framework, endpoints, fecha). `--json` vuelca las entradas en JSONL,
 * igual que están en disco, para encadenar con `jq` u otra herramienta.
 *
 * Uso:
 *   bun scripts/history.script.ts [--limit N] [--project <raíz>] [--json] [--clear]
 *   expostman history [--limit N] [--project <raíz>] [--json] [--clear]
 */
import { hasFlag, readFlag } from "../../core/helpers/argv.helper.js";
import {
  clearHistory,
  formatHistoryJsonl,
  readHistory,
} from "../../ui/server/history.service.js";
import { historyPath } from "../../ui/history-paths.helper.js";
import type { IHistoryEntry } from "../../contracts/interfaces/cli/history.interface.js";

/** Lo que devuelve `runHistory`: código de salida y texto para stdout. */
export interface IHistoryOutcome {
  readonly code: 0 | 1;
  readonly output: string;
}

function formatEntry(entry: IHistoryEntry, anchoProyecto = 24): string {
  const fecha = entry.timestamp.replace("T", " ").slice(0, 19);
  const verb = entry.kind === "generate" ? "generated" : "summarised";
  const cols = entry.projectName.padEnd(anchoProyecto);
  const fw = entry.framework.padEnd(10);
  return `${fecha}  ${verb.padEnd(11)} ${cols} ${fw} ${String(entry.endpoints).padStart(4)} endpoints`;
}

/**
 * Decide el ancho de la columna de proyecto según la entrada más larga
 * del lote. Sin esto, un proyecto con nombre de 30 caracteres se sale
 * de la columna y el siguiente parece parte del nombre.
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
    const donde = `${home}/.expostman/history.jsonl`;
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

/** Argumentos opcionales de `runHistory`, en un solo objeto. */
export interface IRunHistoryOptions {
  /** Ruta absoluta al fichero de historial. Si falta, se calcula con `historyPath()`. */
  readonly historyPath?: string;
  /** HOME a usar para resolver `historyPath()`. Solo si no se pasa `historyPath`. */
  readonly home?: string;
}

/**
 * Lee y muestra el historial.
 *
 * `argv` y `options` se inyectan para que `tests/cli/history.spec.ts`
 * pueda ejercitar el comando sin tocar el sistema: `--limit`,
 * `--project`, `--json` y `--clear` se leen aquí mismo.
 *
 * La ruta del historial se calcula desde `options.historyPath` o, en
 * su defecto, `options.home`. Sin ninguna, delega en `historyPath()`
 * (que usa `process.env.HOME` por convención). Esto último es lo que
 * hace `main()` para producción; los tests pasan siempre una ruta
 * concreta para no escribir en `~/.expostman/` de quien corre la
 * suite.
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

/** La envoltura que usa el CLI: solo el código de salida. */
export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  return (await runHistory(argv)).code;
}

if (import.meta.main) {
  process.exit(await main());
}

// Re-export para los tests que prefieran la ruta de disco.
export { historyPath };
