/**
 * The contracts project imports nothing from anyone.
 *
 * This is the single property that makes it useful. A contract that needs
 * to reach into `core/` or `frameworks/` for typing is not a contract: it
 * is the signature of an implementation under another name, and whoever
 * consumes it drags that implementation along.
 *
 * And that is exactly the problem this section exists to solve. Today the
 * UI imports `IProjectSummary` from `core/discovery/summary.service`, and
 * the plugin imports the catalog from `frameworks/index` — which drags in
 * all 21 scanners — just to read a list of names.
 *
 * `tsconfig.contracts.json` already prevents this at compile time, because
 * it includes only this folder. This test also checks the source text,
 * which is what catches a `import type` with an upward relative path
 * before anyone approves it.
 */
import { describe, expect, test } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The folder is located without `scripts/helpers/root.helper`, on purpose.
 *
 * Importing it would add `scripts/` to the `tsconfig.contracts.json`
 * program, and then "the section compiles on its own" would be a lie in
 * the very file that comes to verify it.
 */
const AQUI = dirname(fileURLToPath(import.meta.url));
const CONTRACTS = join(AQUI, "..", "..", "packages", "contracts");

/** The `.ts` files of a tree, without depending on the repo walker. */
async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectFiles(full)));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** The relative specifiers imported by a file. */
function importsRelativos(source: string): string[] {
  const encontrados: string[] = [];
  const re = /(?:from|import)\s*\(?\s*["'](\.[^"']*)["']/g;
  for (const linea of source.split("\n")) {
    if (/^\s*(\*|\/\/)/.test(linea)) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(linea)) !== null) {
      if (m[1]) encontrados.push(m[1]);
    }
  }
  return encontrados;
}

const ficheros = await collectFiles(CONTRACTS);

describe("packages/contracts/", () => {
  test("has contracts inside", () => {
    expect(ficheros.length).toBeGreaterThan(0);
  });

  /**
   * THE test: not a single import may leave the folder.
   *
   * The path is **resolved** rather than just checking whether it starts
   * with `../..`. That heuristic produced a false positive as soon as a
   * contract in `interfaces/cli/` imported one from `constants/cli/`: it
   * goes up two levels and stays inside `packages/contracts/`, which is
   * exactly what should be allowed. A contract may build on another; what
   * it cannot do is build on an implementation.
   */
  test.for(ficheros)("%s imports nothing from outside", async (fichero) => {
    const source = await readFile(fichero, "utf8");
    const fuera = importsRelativos(source).filter((spec) => {
      const destino = resolve(dirname(fichero), spec);
      return relative(CONTRACTS, destino).startsWith("..");
    });
    expect(fuera, `${relative(CONTRACTS, fichero)} sale de packages/contracts/`).toEqual(
      [],
    );
  });

  /**
   * A contract is a declaration. If it carries executable code, whoever
   * imports it brings that code — and its effects — along at startup.
   */
  test.for(ficheros)("%s carries no implementation", async (fichero) => {
    const source = await readFile(fichero, "utf8");
    const sinComentarios = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(sinComentarios).not.toMatch(/^export\s+(async\s+)?function\s/m);
    expect(sinComentarios).not.toMatch(/^export\s+class\s/m);
  });
});
