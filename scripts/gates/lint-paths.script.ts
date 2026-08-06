#!/usr/bin/env bun
/**
 * `bun run lint:paths` — prohibido contar `..` hasta la raíz.
 *
 * Escribir `resolve(__dirname, "../../..")` ata un fichero a su
 * profundidad en el árbol. En cuanto se mueve, la constante apunta a
 * otro sitio **y no falla**: una ruta equivocada no lanza, simplemente
 * no encuentra nada. Durante la reorganización esto mordió cuatro
 * veces, y las cuatro fueron silenciosas — el lint de propuestas llegó
 * a decir "no se encontró ninguna propuesta" como si el repo estuviera
 * vacío.
 *
 * En su lugar:
 *   - Tooling y tests del repo → `scripts/helpers/root.helper.ts`, que
 *     tiene un nombre para cada carpeta conocida.
 *   - Código de producción     → `findRepoRoot()` de
 *     `projects/core/helpers/module-path.helper.ts`, que busca un
 *     marcador y devuelve `null` dentro del binario compilado.
 *   - Tests del plugin         → `workspaceRoot()` de su
 *     `tests/helpers/plugin-context.ts`.
 *
 * Uso:
 *   bun run lint:paths
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

/** Subir dos o más niveles desde la carpeta del módulo. */
const DEPTH_COUNTING = /(?:__dirname|moduleDir\([^)]*\))\s*,\s*["'](?:\.\.\/){2,}\.?\.?["']/;
/** La forma con segmentos sueltos: `resolve(dir, "..", "..")`. */
const DEPTH_SEGMENTS = /(?:__dirname|moduleDir\([^)]*\))(?:\s*,\s*["']\.\.["']){2,}/;

/**
 * Ficheros que SÍ pueden hacerlo: son los que implementan la
 * alternativa, y tienen que resolver algo por su cuenta.
 */
const ALLOWED = new Set([
  "scripts/helpers/root.helper.ts",
  "projects/core/helpers/module-path.helper.ts",
  "projects/plugins/mcp-vertex_expostman/tests/helpers/plugin-context.ts",
  "scripts/gates/lint-paths.script.ts",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  "fixtures",
  "smoke-fixtures",
]);

async function collect(dir: string, out: string[] = []): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as never;
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

async function main(): Promise<number> {
  const files = await collect(REPO_ROOT);
  const problems: string[] = [];
  let checked = 0;

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    if (ALLOWED.has(rel)) continue;
    checked++;

    const lines = (await readFile(file, "utf8")).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      // Los docblocks explican el patrón prohibido a propósito.
      if (/^\s*(\*|\/\/)/.test(line)) continue;
      if (DEPTH_COUNTING.test(line) || DEPTH_SEGMENTS.test(line)) {
        problems.push(`${rel}:${i + 1}\n      ${line.trim()}`);
      }
    }
  }

  if (problems.length > 0) {
    console.error(
      `lint:paths — ${problems.length} sitio(s) contando ".." hasta la raíz:\n`,
    );
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error(
      "\n  Usa el registro de rutas en vez de la profundidad:\n" +
        "    tooling y tests → scripts/helpers/root.helper.ts\n" +
        "    producción      → findRepoRoot() de projects/core/helpers/\n",
    );
    return 1;
  }

  console.log(`lint:paths — ${checked} ficheros, ninguno atado a su profundidad`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
