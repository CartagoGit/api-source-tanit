#!/usr/bin/env bun
/**
 * `bun run lint:mcp-surface` — que todo tool del plugin tenga contrato.
 *
 * El invariante universal §6, que `AGENT-BOOTSTRAP.md` copia por
 * referencia y §3.2 repite, dice que **todo tool público declara un
 * `outputSchema`**. Ninguno de los cuatro lo hacía, y nadie lo notó
 * porque no había nada que lo mirara: `lint:tsdoc` comprueba los
 * exports del área pública, no la superficie MCP.
 *
 * La diferencia no es formal. Un agente que llama a
 * `mcp-vertex_expostman_generate` y recibe una salida sin esquema no
 * puede validar la respuesta ni saber qué campos existen sin ejecutarla
 * y mirar lo que sale. Y esta es la superficie **pública** del proyecto
 * hacia otros agentes, que es donde un contrato importa más, no menos.
 *
 * Lo que se comprueba, por cada `*.tool.ts`:
 *
 *   1. Declara `inputSchema`.
 *   2. Declara `outputSchema`.
 *   3. Ninguno de los dos usa `z.any()` ni `z.unknown()` en la raíz —
 *      un esquema que acepta cualquier cosa no es un contrato, es la
 *      ausencia de uno con más pasos.
 *   4. El esquema de salida se usa de verdad: el handler devuelve un
 *      valor anotado con su tipo, no un spread de un objeto ajeno.
 *      Esto último se coló: `summary.tool.ts` declaraba seis campos y
 *      devolvía dieciocho con `toolJson({ ok: true, ...summary })`.
 *
 * Uso:
 *   bun run lint:mcp-surface
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

/** Dónde viven los tools del plugin. */
const TOOLS_DIR = join(
  REPO_ROOT,
  "projects/plugins/mcp-vertex_expostman/src/lib/tools",
);

interface IProblem {
  readonly file: string;
  readonly detail: string;
}

/** Un `z.any()` o `z.unknown()` suelto en la definición de un esquema. */
const PERMISIVO = /\bz\.(any|unknown)\s*\(/;

/**
 * `toolJson` con un spread directo: la salida deja de estar tipada y el
 * `outputSchema` pasa a describir algo que nadie comprueba.
 */
const SPREAD_SIN_TIPAR = /toolJson\(\s*\{[^}]*\.\.\./s;

async function toolFiles(): Promise<string[]> {
  try {
    const entries = await readdir(TOOLS_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".tool.ts"))
      .map((e) => join(TOOLS_DIR, e.name))
      .sort();
  } catch {
    return [];
  }
}

async function main(): Promise<number> {
  const files = await toolFiles();
  if (files.length === 0) {
    console.error(`lint:mcp-surface — no se encontró ningún *.tool.ts en ${TOOLS_DIR}`);
    return 1;
  }

  const problems: IProblem[] = [];

  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    const source = await readFile(file, "utf8");

    if (!/\binputSchema\s*:/.test(source)) {
      problems.push({ file: rel, detail: "no declara `inputSchema`" });
    }
    if (!/\boutputSchema\s*:/.test(source)) {
      problems.push({
        file: rel,
        detail:
          "no declara `outputSchema` — el agente que lo llame no puede saber qué recibe",
      });
    }
    if (PERMISIVO.test(source)) {
      problems.push({
        file: rel,
        detail: "usa `z.any()` o `z.unknown()`: eso no es un contrato",
      });
    }
    if (SPREAD_SIN_TIPAR.test(source)) {
      problems.push({
        file: rel,
        detail:
          "devuelve un spread sin tipar: anota el objeto con su tipo de salida " +
          "para que el compilador exija lo que el esquema promete",
      });
    }
  }

  if (problems.length > 0) {
    console.error(`lint:mcp-surface — ${problems.length} problema(s):\n`);
    for (const p of problems) console.error(`  ✗ ${p.file} — ${p.detail}`);
    console.error(
      "\n  El invariante universal §6 pide un `outputSchema` por tool.\n" +
        "  Los esquemas viven en `src/lib/contracts/plugin.interface.ts`.",
    );
    return 1;
  }

  console.log(
    `lint:mcp-surface — ${files.length} tools, todos con contrato de entrada y de salida`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
