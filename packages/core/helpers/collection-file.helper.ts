/**
 * Leer la colección del disco, o explicar por qué no se puede.
 *
 * Cuatro comandos —`list`, `stats`, `check` y `validate`— empiezan
 * leyendo el mismo fichero, y cada uno lo hacía a su manera. `list` y
 * `stats` no lo hacían de ninguna: llamaban a `readFile` directamente, y
 * sin colección en disco la persona veía esto:
 *
 * ```
 * 20 |   const raw = await readFile(COLLECTION_PATH, "utf8");
 *                          ^
 * ENOENT: no such file or directory, open '/…/sample-express.postman_collection.json'
 *     path: "/…"
 *  syscall: "open"
 * ```
 *
 * Cinco líneas de volcado, el código fuente del comando por encima, y
 * ni una palabra sobre qué hacer — cuando la respuesta es siempre la
 * misma: ejecutar `generate` primero.
 *
 * Un error que no dice la salida deja a quien lo lee igual de atascado
 * que si no dijera nada, y encima parece que la herramienta se ha roto.
 */
import { readFile } from "node:fs/promises";

import type { PostmanCollection } from "../../contracts/interfaces/core/postman.interface.js";
import type { CollectionRead } from "../../contracts/interfaces/core/helpers.interface.js";

/**
 * Lee y parsea la colección.
 *
 * Distingue los tres fallos que importan, porque cada uno tiene una
 * salida distinta: que no exista (falta generar), que no se pueda leer
 * (permisos) y que no sea JSON válido (se escribió a medias, que es lo
 * que `atomic-write.helper` existe para evitar).
 */
export async function readCollection(path: string): Promise<CollectionRead> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        reason: `No collection at '${path}'.`,
        nextAction:
          "Generate it first:\n" +
          "  apisrc generate --project-root <your-project>\n" +
          "If it lives elsewhere, say so with `--output-dir`.",
      };
    }
    return {
      ok: false,
      reason: `Could not read '${path}': ${(error as Error).message}`,
      nextAction: "Check the permissions on the file and its folder.",
    };
  }

  try {
    return { ok: true, collection: JSON.parse(raw) as PostmanCollection };
  } catch (error) {
    return {
      ok: false,
      reason: `'${path}' exists but is not valid JSON: ${(error as Error).message}`,
      nextAction:
        "That usually means it was written halfway. Generate it again:\n" +
        "  apisrc generate --project-root <your-project>",
    };
  }
}

/**
 * Imprime el fallo en el formato del resto del CLI y devuelve 1, para
 * que un comando pueda hacer `return explain(result)` sin repetir el
 * bloque de `console.error` en cada uno.
 */
export function explainReadFailure(
  failure: Extract<CollectionRead, { ok: false }>,
): number {
  console.error(`\n✗ ${failure.reason}`);
  for (const line of failure.nextAction.split("\n")) {
    console.error(`  · ${line}`);
  }
  return 1;
}
