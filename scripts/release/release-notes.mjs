#!/usr/bin/env bun
/**
 * `bun run scripts/release/release-notes.mjs --version <version>` — las
 * notas de la release, sacadas del CHANGELOG.
 *
 * ## Por qué no se escriben a mano
 *
 * Porque las notas de una release y la sección del CHANGELOG son la
 * misma información en dos sitios. Cuando se escriben dos veces, una
 * de las dos se queda vieja: la release dice una cosa y el CHANGELOG
 * otra, y el que lee la release no tiene por qué ir a mirar el
 * CHANGELOG.
 *
 * Por eso la sección del CHANGELOG **es** las notas, y este script la
 * extrae tal cual.
 *
 * ## Por qué falla si no la encuentra
 *
 * Porque una release sin notas es una release que dice "no hay
 * nada". Cortar un tag sin sección en el CHANGELOG es un error de
 * proceso —falta el commit que la escribió— y tiene que parar el
 * workflow, no salir con un cuerpo vacío.
 *
 * La regla vive en `scripts/helpers/release-notes.helper.ts`, que es
 * donde está el typecheck; aquí sólo está la línea de comandos.
 *
 * Uso:
 *   bun run scripts/release/release-notes.mjs --version 0.1.0-alpha.1
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";
import { sectionFor } from "../helpers/release-notes.helper.js";

/**
 * La versión de la que se quieren las notas.
 *
 * @param {ReadonlyArray<string>} argv
 * @returns {string | null}
 */
function readVersionArgument(argv) {
  const index = argv.indexOf("--version");
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

async function main() {
  const version = readVersionArgument(process.argv.slice(2));
  if (!version) {
    console.error(
      "release-notes — falta --version <version>\n" +
        "  uso: bun run scripts/release/release-notes.mjs --version 0.1.0-alpha.1",
    );
    return 1;
  }

  const changelog = await readFile(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
  const section = sectionFor(changelog, version);
  if (!section) {
    console.error(
      `release-notes — el CHANGELOG no tiene sección para "${version}".\n` +
        "  Una release sin notas no sale: escribe primero la sección\n" +
        "  en CHANGELOG.md y vuelve a cortar el tag.",
    );
    return 1;
  }
  console.log(section);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
