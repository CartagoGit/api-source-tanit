#!/usr/bin/env bun
/**
 * `bun run lint:durable-writes` — nada del producto se escribe en crudo.
 *
 * `writeFile` sobre una ruta que ya existe trunca primero y escribe
 * después. Entre esos dos momentos el fichero está a medias, y lo que
 * queda si el proceso muere ahí no es una colección incompleta: es un
 * JSON truncado, que Postman no abre.
 *
 * Los ocho sitios que escribían así se pasaron a
 * `core/helpers/atomic-write.helper.ts` (temporal + `rename`). Este gate
 * existe para que el noveno no vuelva a hacerlo, porque `writeFile` es
 * lo que sale al escribir sin pensarlo y nadie revisa un `writeFile` en
 * una revisión.
 *
 * Qué se permite y por qué:
 *
 *   - **El propio helper**, que es quien hace el temporal y el rename.
 *   - **`scripts/`**, que es tooling del repo: si un gate deja un
 *     fichero a medias, se vuelve a lanzar y ya está. Lo que no se
 *     puede perder es el trabajo de quien usa la herramienta.
 *   - **`tests/`**, que preparan fixtures en directorios temporales.
 *
 * La lista está escrita, no adivinada: un permiso implícito es un
 * permiso que crece solo.
 *
 * Uso:
 *   bun run lint:durable-writes
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";

/** Dónde se busca: lo que se ejecuta cuando alguien usa la herramienta. */
const ROOTS = ["packages"] as const;

/** Carpetas que no se recorren. */
const SKIP = new Set(["node_modules", "dist", "build", ".cache", ".git"]);

/**
 * Ficheros donde una escritura cruda es legítima, con el motivo al lado.
 * Rutas relativas a la raíz del repo.
 */
const PERMITIDOS: Readonly<Record<string, string>> = {
  "packages/core/helpers/atomic-write.helper.ts":
    "es quien implementa el temporal y el rename",
};

/** Las llamadas que dejan un fichero a medias si el proceso muere. */
const ESCRITURA_CRUDA = /\b(writeFile|writeFileSync|appendFile|appendFileSync)\s*\(/;

interface IProblem {
  readonly file: string;
  readonly line: number;
  readonly source: string;
}

async function tsFiles(dir: string, out: string[] = []): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      await tsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

async function main(): Promise<number> {
  const problems: IProblem[] = [];
  let revisados = 0;

  for (const root of ROOTS) {
    for (const file of await tsFiles(join(REPO_ROOT, root))) {
      const rel = relative(REPO_ROOT, file);
      if (PERMITIDOS[rel] !== undefined) continue;
      // Los tests del plugin viven dentro de `packages/`.
      if (rel.includes("/tests/")) continue;
      revisados += 1;

      const lines = (await readFile(file, "utf8")).split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        // El import del helper menciona el nombre; no es una llamada.
        if (line.includes("atomic-write.helper")) continue;
        if (ESCRITURA_CRUDA.test(line)) {
          problems.push({ file: rel, line: i + 1, source: line.trim() });
        }
      }
    }
  }

  if (problems.length > 0) {
    console.error(`lint:durable-writes — ${problems.length} escritura(s) en crudo:\n`);
    for (const p of problems) {
      console.error(`  ✗ ${p.file}:${p.line}`);
      console.error(`      ${p.source}`);
    }
    console.error(
      "\n  Usa `writeFileAtomic` / `writeJsonAtomic` de\n" +
        "  `packages/core/helpers/atomic-write.helper.ts`: escriben en un\n" +
        "  temporal del mismo directorio y renombran, así que un fallo a\n" +
        "  mitad deja el fichero anterior intacto en vez de truncado.",
    );
    return 1;
  }

  console.log(
    `lint:durable-writes — ${revisados} ficheros, ninguna escritura que pueda dejar un fichero a medias`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
