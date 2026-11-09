/**
 * Los globs del repo, en un solo sitio.
 *
 * El repo ya tenía dos implementaciones de "esto casa con este patrón":
 * una dentro de `scripts/release/publish-gate.mjs` y otra dentro de
 * `scripts/release/verify-signature.sh`. Cuando hay dos, una de las dos
 * se queda vieja: la que nadie usa deja de arreglarse, y la release
 * adjunta un fichero que el gate no esperaba.
 *
 * ## La semántica es la de GitHub
 *
 *   · El doble asterisco seguido de barra casa con cero o más carpetas.
 *   · `*` no cruza una carpeta.
 *   · `?` casa con un carácter que no sea `/`.
 *
 * Es la misma que usa `softprops/action-gh-release` cuando le pasan un
 * patrón, y la misma que necesita `RELEASE_PUBLISH_PATTERNS` para
 * describir lo que se adjunta a la release.
 *
 * ## Por qué una función y no una librería
 *
 * Porque una librería de globs trae features que aquí sobran —extglob,
 * negación, corchetas— y cada feature es una forma de que el patrón
 * signifique algo distinto de lo que el que lo escribió cree. El
 * patrón tiene que ser legible en la constante que lo declara.
 */

/** La forma de un patrón que este repo usa. */
export type GlobPattern = string;

/**
 * Convierte un patrón de glob en una expresión regular.
 *
 * La conversión es de una sola pasada: si se reemplazase el doble
 * asterisco con barra primero y el asterisco simple después, el
 * asterisco del grupo insertado se volvería a convertir, y el patrón
 * casaría con `a/b/c.deb` **y** con `a/b.deb/c`.
 */
export function globToRegExp(pattern: GlobPattern): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = escaped.replace(/\*\*\/|\*|\?/g, (match) => {
    if (match === "**/") return "(?:.*/)?";
    if (match === "*") return "[^/]*";
    return "[^/]";
  });
  return new RegExp(`^${body}$`);
}

/**
 * ¿La ruta casa con alguno de los patrones?
 *
 * La ruta se compara **completa**, con `/` como separador: un patrón
 * como el de una clave privada tiene que encontrar `linux/x64/sbom/key.pem`
 * y no encuentra `key.pem` en la raíz si el patrón dice "doble asterisco
 * seguido de barra".
 */
export function matchesAnyGlob(path: string, patterns: readonly GlobPattern[]): boolean {
  const normalized = path.replaceAll("\\", "/");
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}
