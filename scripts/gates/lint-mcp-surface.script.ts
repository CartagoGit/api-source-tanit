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
 * `delendai_tanit_generate` y recibe una salida sin esquema no
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
 *      devolvía dieciocho con `toolJson({ ok: true, ...summary })`. *   5. Un tool que declara el efecto `write` dice **dónde** escriben
 *      sus escrituras (`writeRoot`). El host no arranca un tool que
 *      escribe sin declararlo: el servidor MCP muere al arrancar y el
 *      fallo sólo aparece cuando el editor abre el workspace. Es un
 *      fallo de arranque, no un aviso: por eso lo comprueba una gate
 *      y no un test de runtime. *
 * Uso:
 *   bun run lint:mcp-surface
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

/** Dónde viven los tools del plugin. */
const TOOLS_DIR = join(
  REPO_ROOT,
  "integrations/delendai/src/lib/tools",
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

/**
 * Las raíces que el host acepta para un tool que escribe.
 *
 * `'caller-checkout'` es el árbol del llamante, `'repository'` un
 * hecho del repositorio entero, `'host-state'` estado fuera de
 * cualquier árbol de trabajo, `'server'` la raíz del propio servidor
 * y `'remote'` nada aterriza en esta máquina.
 */
const WRITE_ROOTS = [
  "caller-checkout",
  "repository",
  "host-state",
  "server",
  "remote",
] as const;

/**
 * El código sin los comentarios.
 *
 * Los docblocks de los tools explican **por qué** declaran su
 * `writeRoot`, así que un `writeRoot: "server"` escrito en la prosa
 * haría pasar la comprobación con la declaración ausente. La gate
 * lee el código, no la explicación del código.
 */
const sinComentarios = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

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
    const code = sinComentarios(source);

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

    /**
     * El efecto `write` obliga a decir dónde escriben las
     * escrituras. Sin `writeRoot` el host **no arranca**: lo dice
     * `planRegistrationOrder` y el servidor MCP muere con un error
     * que sólo se ve al abrir el workspace.
     */
    const escribe = [...code.matchAll(/effects:\s*\[([^\]]*)\]/g)].some((m) =>
      /["']write["']/.test(m[1] ?? ""),
    );
    if (escribe) {
      const raiz = /writeRoot:\s*["']([^"']+)["']/.exec(code)?.[1];
      if (raiz === undefined) {
        problems.push({
          file: rel,
          detail:
            "declara el efecto `write` y no dice dónde escriben sus escrituras " +
            "(`writeRoot`): el host no arranca un tool así",
        });
      } else if (!(WRITE_ROOTS as readonly string[]).includes(raiz)) {
        problems.push({
          file: rel,
          detail:
            `declara writeRoot "${raiz}", que no es una raíz válida ` +
            `(${WRITE_ROOTS.join(", ")})`,
        });
      }
    }
  }

  if (problems.length > 0) {
    console.error(`lint:mcp-surface — ${problems.length} problema(s):\n`);
    for (const p of problems) console.error(`  ✗ ${p.file} — ${p.detail}`);
    console.error(
      "\n  El invariante universal §6 pide un `outputSchema` por tool.\n" +
        "  Un tool que escribe dice además `writeRoot`: dónde escriben sus\n" +
        "  escrituras. El host no arranca un tool que escribe sin declararlo.\n" +
        "  Los esquemas viven en `src/lib/contracts/plugin.interface.ts`.",
    );
    return 1;
  }

  console.log(
    `lint:mcp-surface — ${files.length} tools, todos con contrato de entrada y de salida ` +
      `y con la raíz de escritura declarada donde hace falta`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
