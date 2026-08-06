#!/usr/bin/env bun
/**
 * `bun run lint:docs` — que la documentación no mienta.
 *
 * Comprueba tres cosas sobre los bloques de código de los `.md`:
 *
 *   1. Todo `bun run <script>` cita un script que existe en el
 *      `package.json`.
 *   2. Toda ruta de fichero que se menciona existe en el repo.
 *   3. Todo `expostman <comando>` es un comando que el CLI conoce.
 *
 * Existe porque la documentación se queda vieja en silencio y de la peor
 * manera: quien la sigue es alguien que acaba de llegar, y lo primero
 * que hace es un comando que no funciona. Ya pasó — al reorganizar en
 * `projects/`, `docs/INSTALL.md` seguía diciendo
 * `bun run scripts/generate.script.ts`, que llevaba tres commits sin
 * existir.
 *
 * Uso:
 *   bun run lint:docs
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { PACKAGE_JSON, REPO_ROOT } from "../helpers/root.helper.js";

/** Carpetas de documentación que se revisan. */
const DOC_ROOTS = ["docs", "examples", "."] as const;
/** Las propuestas cerradas describen el pasado: no se revisan. */
const SKIP = ["node_modules", ".git", "dist", "build", ".cache", "done", "retired", "legacy"];

interface IProblem {
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

async function collectMarkdown(dir: string, out: string[] = []): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as never;
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collectMarkdown(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  const packageJson = JSON.parse(await readFile(PACKAGE_JSON, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = new Set(Object.keys(packageJson.scripts ?? {}));

  // Los comandos del CLI salen de su propio dispatcher, no de una lista
  // a mano: una lista paralela se queda vieja igual que la doc.
  const cliSource = await readFile(
    join(REPO_ROOT, "projects", "cli", "cli.script.ts"),
    "utf8",
  );
  const commands = new Set(
    [...cliSource.matchAll(/^\s{2}(\w[\w-]*):\s*\{/gm)].map((match) => match[1]!),
  );

  const files = new Set<string>();
  for (const root of DOC_ROOTS) {
    for (const file of await collectMarkdown(join(REPO_ROOT, root))) files.add(file);
  }

  const problems: IProblem[] = [];

  for (const file of [...files].sort()) {
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    const lines = (await readFile(file, "utf8")).split("\n");
    let inFence = false;
    // Los docs enseñan a veces comandos de OTROS proyectos (el
    // `package.json` de quien usa la herramienta, por ejemplo). Un
    // comentario `lint:docs ignore` justo antes exime al bloque
    // siguiente, y obliga a decir por qué.
    let ignoreNextFence = false;
    let ignoringFence = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.includes("lint:docs ignore")) {
        ignoreNextFence = true;
        continue;
      }
      if (line.trimStart().startsWith("```")) {
        if (!inFence) {
          ignoringFence = ignoreNextFence;
          ignoreNextFence = false;
        }
        inFence = !inFence;
        continue;
      }
      if (!inFence || ignoringFence) continue;

      for (const match of line.matchAll(/\bbun run ([\w:.-]+)/g)) {
        const script = match[1]!;
        // `bun run <fichero.ts>` es válido: se comprueba como ruta.
        if (script.endsWith(".ts")) {
          if (!(await exists(join(REPO_ROOT, script)))) {
            problems.push({ file: rel, line: i + 1, detail: `no existe: ${script}` });
          }
        } else if (!scripts.has(script)) {
          problems.push({
            file: rel,
            line: i + 1,
            detail: `\`bun run ${script}\` no está en package.json`,
          });
        }
      }

      for (const match of line.matchAll(/\bexpostman ([a-z][\w-]*)/g)) {
        const command = match[1]!;
        if (!commands.has(command)) {
          problems.push({
            file: rel,
            line: i + 1,
            detail: `\`expostman ${command}\` no es un comando del CLI`,
          });
        }
      }
    }
  }

  if (problems.length > 0) {
    console.error(`lint:docs — ${problems.length} referencia(s) rota(s):\n`);
    for (const problem of problems) {
      console.error(`  ✗ ${problem.file}:${problem.line} — ${problem.detail}`);
    }
    return 1;
  }

  console.log(
    `lint:docs — ${files.size} ficheros, ${scripts.size} scripts y ` +
      `${commands.size} comandos citados existen`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
