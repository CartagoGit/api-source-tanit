/**
 * La sección del CHANGELOG que describe una versión.
 *
 * ## Por qué vive aquí y no en el script
 *
 * Porque es lógica con reglas —qué es una cabecera, dónde acaba una
 * sección— y las reglas se prueban mejor en TypeScript que en un
 * `.mjs` que el typecheck no ve. El script
 * `scripts/release/release-notes.mjs` es la envoltura de línea de
 * comandos; la regla vive aquí.
 *
 * ## La regla
 *
 * Las notas de una release **son** la sección del CHANGELOG de esa
 * versión. No hay dos copias que se puedan quedar viejas: hay una.
 *
 * La sección empieza en la cabecera `## <versión> (...)` y acaba en
 * la siguiente cabecera `## `. La fecha y el título son opcionales,
 * así que la búsqueda es por el número de versión, que es lo único
 * que no puede faltar.
 */

/** La cabecera del CHANGELOG que se busca, con la fecha opcional. */
const HEADING = /^##\s+(\S+)(?:\s+\([^)]*\))?\s*(?:[—-].*)?$/;

/**
 * La sección del CHANGELOG que describe una versión.
 *
 * Devuelve `null` cuando no hay ninguna. Es lo que hace que el
 * workflow que corta la release **pare**: una release sin notas es una
 * release que dice "no hay nada", y eso es un error de proceso —falta
 * el commit que la escribió— que tiene que parar el corte.
 */
export function sectionFor(changelog: string, version: string): string | null {
  const lines = changelog.split("\n");
  let start = -1;
  let heading = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = HEADING.exec(line);
    if (!match) continue;
    if (match[1] === version) {
      start = index;
      heading = line;
      break;
    }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("## ")) {
      end = index;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join("\n").trim();
  return `${heading}\n${body}`.trim();
}
