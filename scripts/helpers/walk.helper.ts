/**
 * Recorrer un árbol de ficheros, una sola vez.
 *
 * Trece gates de `scripts/gates/` llevaban su propia copia de esta
 * función, con el mismo nombre (`collectTsFiles`), el mismo `try/catch`
 * y la misma lista de carpetas a saltar — copiada, no compartida. Y no
 * eran idénticas: unas saltaban `docs/`, otras no, y una se dejaba
 * `.cache`. Trece implementaciones de "recorre y dame los ficheros" que
 * no recorrían lo mismo.
 *
 * Esto es tooling del repo. El código que se publica **no** lo usa: para
 * eso está `packages/core/helpers/fs-walk.helper.ts`, que además resuelve
 * enlaces simbólicos y limita la profundidad porque recorre proyectos de
 * otra gente. Aquí el árbol es el nuestro y se sabe lo que hay.
 */
import { readdir, type Dirent } from "node:fs/promises";
import { join } from "node:path";

/**
 * Carpetas que no se recorren nunca.
 *
 * `dist` y `build` son salida; `node_modules` es de terceros; `.cache`
 * y `.git` son estado. Ninguna contiene código de este repo, y entrar
 * en `node_modules` convierte un gate de dos segundos en uno de dos
 * minutos.
 */
export const SKIPPED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  ".cache",
  ".git",
]);

/** Opciones de {@link collectFiles}. */
export interface ICollectOptions {
  /** Carpetas extra que saltar, además de {@link SKIPPED_DIRS}. */
  readonly skip?: ReadonlySet<string> | undefined;
}

/**
 * Los ficheros con alguna de esas extensiones, recorriendo hacia abajo.
 *
 * Devuelve rutas absolutas, ordenadas, para que un gate que informa de
 * varios problemas los liste siempre en el mismo orden — un gate cuya
 * salida cambia de orden entre ejecuciones es un gate que no se puede
 * diffear.
 *
 * Un directorio ilegible se salta en silencio: se pierde esa carpeta y
 * solo esa, en vez de tumbar el recorrido entero.
 */
export async function collectFiles(
  dir: string,
  extensions: readonly string[],
  options: ICollectOptions = {},
): Promise<string[]> {
  const out: string[] = [];
  const skip = options.skip;

  const walk = async (current: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        if (skip?.has(entry.name) === true) continue;
        await walk(full);
        continue;
      }
      if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
        out.push(full);
      }
    }
  };

  await walk(dir);
  return out.sort();
}
