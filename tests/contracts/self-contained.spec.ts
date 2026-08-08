/**
 * El proyecto de contratos no importa de nadie.
 *
 * Es la única propiedad que lo hace útil. Un contrato que necesita
 * alcanzar `core/` o `frameworks/` para tiparse no es un contrato: es la
 * firma de una implementación con otro nombre, y quien lo consuma se
 * lleva esa implementación detrás.
 *
 * Y es exactamente el problema del que sale esta sección. Hoy la UI
 * importa `IProjectSummary` de `core/discovery/summary.service`, y el
 * plugin importa `SUPPORTED_FRAMEWORKS` de `frameworks/index` —que
 * arrastra los 21 scanners— solo para leer una lista de nombres.
 *
 * `tsconfig.contracts.json` ya lo impide en compilación, porque incluye
 * únicamente esta carpeta. Esto lo comprueba además sobre el texto, que
 * es lo que caza un `import type` con ruta relativa hacia arriba antes
 * de que alguien lo dé por bueno.
 */
import { describe, expect, test } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * La carpeta se localiza sin `scripts/helpers/root.helper`, a propósito.
 *
 * Importarlo metería `scripts/` en el programa de
 * `tsconfig.contracts.json`, y entonces «la sección compila sola» sería
 * mentira justo en el fichero que viene a comprobarlo.
 */
const AQUI = dirname(fileURLToPath(import.meta.url));
const CONTRACTS = join(AQUI, "..", "..", "projects", "contracts");

/** Los `.ts` de un árbol, sin depender del walker del repo. */
async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectFiles(full)));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Los especificadores relativos que importa un fichero. */
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

describe("projects/contracts/", () => {
  test("tiene contratos dentro", () => {
    expect(ficheros.length).toBeGreaterThan(0);
  });

  /** EL test: ni un import que salga de la carpeta. */
  test.for(ficheros)("%s no importa nada de fuera", async (fichero) => {
    const source = await readFile(fichero, "utf8");
    const fuera = importsRelativos(source).filter((spec) => spec.startsWith("../.."));
    expect(fuera, `${relative(CONTRACTS, fichero)} sale de projects/contracts/`).toEqual(
      [],
    );
  });

  /**
   * Un contrato es una declaración. Si trae código ejecutable, quien lo
   * importe se lleva ese código —y sus efectos— al arrancar.
   */
  test.for(ficheros)("%s no trae implementación", async (fichero) => {
    const source = await readFile(fichero, "utf8");
    const sinComentarios = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(sinComentarios).not.toMatch(/^export\s+(async\s+)?function\s/m);
    expect(sinComentarios).not.toMatch(/^export\s+class\s/m);
  });
});
