/**
 * Helpers para crear fixtures de filesystem en tests.
 *
 * El `mkFixtureSync` acepta un árbol de archivos { path: content } y
 * lo escribe en un tmpdir. Devuelve la ruta absoluta.
 *
 * Esto permite tests unitarios rápidos sin tener un proyecto completo
 * en disco.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { cp as cpAsync, rm as rmAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { OUTPUT_DIR_NAME } from "../../projects/contracts/constants/core/postman.constant";

export type FixtureTree = Record<string, string>;

/**
 * Crea un fixture temporal y devuelve su path absoluto.
 *
 * Ejemplo:
 *   const root = mkFixtureSync({
 *     "package.json": `{"name": "demo"}`,
 *     "src/index.ts": `console.log("hi")`,
 *   });
 */
export function mkFixtureSync(tree: FixtureTree): string {
  const base = mkdtempSync(join(tmpdir(), "export-to-postman-test-"));
  for (const [rel, content] of Object.entries(tree)) {
    const abs = join(base, rel);
    const dir = dirname(abs);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(abs, content, "utf8");
  }
  return base;
}

/**
 * Limpia un fixture creado con `mkFixtureSync`.
 */
export function rmFixtureSync(root: string): void {
  if (existsSync(root)) {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Helper de alto nivel: ejecuta una `fn` con un fixture temporal,
 * lo limpia al terminar.
 */
export function withFixture<T>(tree: FixtureTree, fn: (root: string) => T): T {
  const root = mkFixtureSync(tree);
  try {
    return fn(root);
  } finally {
    rmFixtureSync(root);
  }
}

/**
 * Versión async del `withFixture`.
 */
export async function withFixtureAsync<T>(
  tree: FixtureTree,
  fn: (root: string) => Promise<T>,
): Promise<T> {
  const root = mkFixtureSync(tree);
  try {
    return await fn(root);
  } finally {
    rmFixtureSync(root);
  }
}

/**
 * Copia un proyecto de `examples/` a un temporal **sin lo que generó
 * una ejecución anterior**.
 *
 * `cp` a secas no vale, y el fallo no se ve hasta que muerde. Los
 * ejemplos son proyectos de verdad sobre los que se lanza el CLI, así
 * que acaban con una carpeta `export-to-postman/` dentro. Está en
 * `.gitignore`, no en el repo — pero está **en disco**, y `cp` la copia.
 *
 * `exit-codes.test.ts` lo pagó: creaba un proyecto de solo lectura con
 * `chmod 0555` sobre la raíz para comprobar que `generate` falla al no
 * poder escribir. Con la carpeta de salida ya copiada —y con sus
 * permisos, 0755— `generate` escribía dentro tan tranquilo y salía con
 * 0. El test solo pasaba en una máquina donde nadie hubiera lanzado el
 * CLI sobre los ejemplos; en la de cualquiera que hubiera hecho
 * `bun run build`, fallaba sin motivo aparente.
 *
 * Esto es lo que separa un test de un test que depende de la suerte.
 */
export async function copyExampleClean(source: string, destination: string): Promise<void> {
  await cpAsync(source, destination, { recursive: true });
  await rmAsync(join(destination, OUTPUT_DIR_NAME), { recursive: true, force: true });
}
