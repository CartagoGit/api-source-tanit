/**
 * Directorio del módulo actual, de forma portable.
 *
 * `import.meta.dir` solo existe en Bun. El paquete declara
 * `engines.node >= 20` y los tests corren bajo vitest, así que usarlo
 * dejaba a ambos con `undefined` — y `resolve(undefined, "..")` no
 * falla con un mensaje útil, sino con un `TypeError` sobre `paths[0]`
 * a 3 capas de distancia del sitio real.
 *
 * `import.meta.url` sí es estándar de ESM y funciona en Bun, en Node y
 * bajo vitest. `fileURLToPath` es lo que la convierte en una ruta de
 * sistema válida también en Windows (donde `new URL(...).pathname`
 * devolvería `/C:/…`).
 *
 * @example
 * const PACKAGE_ROOT = resolve(moduleDir(import.meta.url), "..");
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Carpeta que contiene el módulo cuyo `import.meta.url` se pasa. */
export function moduleDir(importMetaUrl: string): string {
  return dirname(fileURLToPath(importMetaUrl));
}

/**
 * Raíz del repo/paquete: sube desde el módulo hasta dar con el
 * `package.json`.
 *
 * Antes cada script contaba sus propios `".."` hasta la raíz. Eso
 * funciona hasta que el fichero cambia de carpeta, y entonces
 * `PACKAGE_ROOT` apunta a otro sitio **sin fallar**: el script
 * simplemente no encuentra nada y dice "no se encontró ninguna
 * propuesta". Pasó con cuatro gates a la vez al reorganizar en
 * `packages/`.
 *
 * Contar niveles es acoplar un fichero a su profundidad en el árbol.
 * Buscar el marcador no.
 */
export function repoRoot(importMetaUrl: string): string {
  const found = findRepoRoot(importMetaUrl);
  if (found) return found;
  throw new Error(
    `No se encontró un package.json subiendo desde ${moduleDir(importMetaUrl)}`,
  );
}

/**
 * Como `repoRoot()`, pero devuelve `null` en vez de lanzar.
 *
 * Lo necesita el código de **producción**: dentro del binario compilado
 * los módulos viven en un sistema de ficheros virtual (`/$bunfs/root/`)
 * donde no hay ningún `package.json`, así que no hay raíz que
 * encontrar. Lanzar allí tumba el binario entero al arrancar — pasó al
 * introducir este helper, y el test del binario sin runtime fue lo que
 * lo cazó.
 *
 * Regla: los gates y los tests usan `repoRoot()`, que lanza porque un
 * fallo ahí es un fallo del repo. El código que acaba dentro del
 * binario usa esta y tiene un plan B.
 */
export function findRepoRoot(importMetaUrl: string): string | null {
  let dir = moduleDir(importMetaUrl);
  for (let up = 0; up < 12; up++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

