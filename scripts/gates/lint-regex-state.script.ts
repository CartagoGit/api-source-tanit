#!/usr/bin/env bun
/**
 * `bun run lint:regex-state` — no se toca el `lastIndex` de un regex
 * compartido.
 *
 * Un regex con la bandera `g` guarda su posición en `lastIndex`. Si vive
 * a nivel de módulo, esa posición es **compartida por todo el que lo
 * use**, y escribirla desde una función es alterar el estado de quien la
 * llamó.
 *
 * No es teórico. En el scanner de Fiber, un helper movía el `lastIndex`
 * del mismo regex que recorría el bucle exterior y lo devolvía al inicio
 * del match actual: el bucle volvía a encontrar la MISMA ruta, para
 * siempre. Bucle infinito, la memoria subiendo, y el sistema operativo
 * matando el proceso — se llevó por delante la sesión entera de WSL.
 *
 * La alternativa es de una línea:
 *
 *     const propio = new RegExp(COMPARTIDO.source, COMPARTIDO.flags);
 *
 * Se permite `lastIndex = 0` justo antes de usar un regex: es el
 * saneamiento habitual y no puede colgar a nadie.
 *
 * Uso:
 *   bun run lint:regex-state
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

/** Cualquier escritura de `lastIndex`, con el valor asignado. */
const ASSIGNMENT = /\b(\w+)\.lastIndex\s*=\s*([^;]+)/;

/**
 * `lastIndex = 0` es seguro y se permite.
 *
 * Es el saneamiento habitual antes de usar un regex `g`: deja el estado
 * en un punto conocido en vez de heredarlo. Lo que cuelga es asignar una
 * posición **arbitraria**, porque el bucle de quien llamó vuelve atrás.
 */
function isReset(value: string): boolean {
  return value.trim() === "0";
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  "fixtures",
  "smoke-fixtures",
]);

/** El propio lint habla del patrón: no puede acusarse a sí mismo. */
const ALLOWED = new Set(["scripts/gates/lint-regex-state.script.ts"]);

async function collect(dir: string, out: string[] = []): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
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

/** Nombres de regex declarados a nivel de módulo con bandera `g`. */
function moduleLevelGlobalRegexes(source: string): Set<string> {
  const names = new Set<string>();
  // `const X = /…/g;` sin indentación = nivel de módulo.
  for (const match of source.matchAll(/^const\s+(\w+)\s*=\s*\/(?:[^/\\\n]|\\.)+\/(\w*)/gm)) {
    if ((match[2] ?? "").includes("g")) names.add(match[1] ?? "");
  }
  // `const X = new RegExp(…, "gi");`
  for (const match of source.matchAll(
    /^const\s+(\w+)\s*=\s*new RegExp\([\s\S]*?["'](\w*)["']\s*,?\s*\);/gm,
  )) {
    if ((match[2] ?? "").includes("g")) names.add(match[1] ?? "");
  }
  return names;
}

async function main(): Promise<number> {
  const files = await collect(REPO_ROOT);
  const problems: string[] = [];
  let checked = 0;

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    if (ALLOWED.has(rel)) continue;

    const source = await readFile(file, "utf8");
    if (!source.includes("lastIndex")) continue;
    checked++;

    const shared = moduleLevelGlobalRegexes(source);
    if (shared.size === 0) continue;

    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (/^\s*(\*|\/\/)/.test(line)) continue;

      const match = ASSIGNMENT.exec(line);
      if (!match) continue;
      if (isReset(match[2] ?? "")) continue;
      const name = match[1] ?? "";
      if (!shared.has(name)) continue;

      problems.push(
        `${rel}:${i + 1}\n      ${line.trim()}\n` +
          `      \`${name}\` es de nivel de módulo y lleva \`g\`: su lastIndex lo comparte\n` +
          `      todo el fichero, así que moverlo a una posición arbitraria puede hacer\n` +
          `      que el bucle de quien llamó vuelva atrás y no termine nunca.\n` +
          `      Usa una copia: const propio = new RegExp(${name}.source, ${name}.flags);`,
      );
    }
  }

  if (problems.length > 0) {
    console.error(
      `lint:regex-state — ${problems.length} escritura(s) peligrosa(s) de lastIndex:\n`,
    );
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    return 1;
  }

  console.log(
    `lint:regex-state — ${checked} ficheros con lastIndex, ninguno pisa un regex compartido`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
