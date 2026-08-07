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
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

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
