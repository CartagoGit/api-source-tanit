/**
 * Los canales de publicación, y de dónde sale el prefijo que los
 * declara.
 *
 * ## Por qué vive en contratos
 *
 * Porque lo necesitan **tres** sitios que no comparten código: el
 * gate que valida la versión, el workflow que corta la release y el
 * test que lo fija. Cuando uno de ellos lleva su propio valor, el
 * canal deja de significar nada: el gate valida una cosa y el workflow
 * publica por otra, y el resultado es una release estable que en
 * realidad es un alfa.
 *
 * ## Por qué no hay ningún `dist-tag`
 *
 * Porque Tanit no se publica en npm. La distribución es la release de
 * GitHub: el ejecutable autocontenido y el instalador. En GitHub el
 * equivalente de un `dist-tag` es el **canal de la release** —la
 * marca de prerelease y su etiqueta—, y las dos salen del canal que
 * se deduce de la versión.
 */

import type { ReleaseChannel } from "../../interfaces/release/release-channel.interface.js";

/** Los canales, del más joven al más maduro. */
export const RELEASE_CHANNELS: ReadonlyArray<ReleaseChannel> = [
  "alpha",
  "beta",
  "rc",
  "stable",
];

/**
 * El canal de una versión con major a partir de 1 y sin sufijo.
 *
 * Sin anotación, a propósito: TypeScript le da el tipo literal
 * `"stable"`, y eso deja que `Exclude<ReleaseChannel, "stable">`
 * estreche al resto de canales cuando se recorre la lista.
 */
export const STABLE_RELEASE_CHANNEL = "stable";

/**
 * El prefijo de prerelease que declara cada canal.
 *
 * `0.1.0-alpha.1` es del canal `alpha`. Sin sufijo, el major indica el
 * canal de distribución. `0.2.0` es beta y `1.0.0` es estable.
 */
export const RELEASE_PRERELEASE_TAGS: Readonly<
  Record<Exclude<ReleaseChannel, "stable">, string>
> = {
  alpha: "alpha",
  beta: "beta",
  rc: "rc",
};
