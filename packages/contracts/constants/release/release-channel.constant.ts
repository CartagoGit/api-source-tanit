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
 * decide el prefijo de la versión.
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
 * El canal de una versión sin prefijo de prerelease.
 *
 * Sin anotación, a propósito: TypeScript le da el tipo literal
 * `"stable"`, y eso deja que `Exclude<ReleaseChannel, "stable">`
 * estreche al resto de canales cuando se recorre la lista.
 */
export const STABLE_RELEASE_CHANNEL = "stable";

/**
 * El prefijo de prerelease que declara cada canal.
 *
 * `0.1.0-alpha.1` es del canal `alpha`; `1.0.0` no lleva prefijo y es
 * del canal estable. El prefijo es lo que **decide** el canal, no al
 * revés: el canal es una consecuencia de la versión, no una decisión
 * que se tome aparte.
 */
export const RELEASE_PRERELEASE_TAGS: Readonly<
  Record<Exclude<ReleaseChannel, "stable">, string>
> = {
  alpha: "alpha",
  beta: "beta",
  rc: "rc",
};
