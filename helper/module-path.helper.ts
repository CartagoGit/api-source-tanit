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
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Carpeta que contiene el módulo cuyo `import.meta.url` se pasa. */
export function moduleDir(importMetaUrl: string): string {
  return dirname(fileURLToPath(importMetaUrl));
}
