/**
 * Los canales de publicación, y de dónde sale el `dist-tag` de npm.
 *
 * ## Por qué vive en contratos
 *
 * Porque lo necesitan **tres** sitios que no comparten código: el
 * gate que valida la versión, el workflow que publica en npm y el
 * verificador que dice si una versión instalada es más nueva que otra.
 * Cuando uno de ellos lleva su propio valor, el canal deja de
 * significar nada: el gate valida una cosa y el workflow publica por
 * otra, y el resultado es un prerelease landado en `latest`.
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
 * El `dist-tag` de npm de cada canal.
 *
 * ## Por qué `latest` es sólo del canal estable
 *
 * `npm install api-source-tanit` sin `--tag` se come lo que hay en
 * `latest`. Si un alfa landinga ahí, cualquiera que instale el
 * paquete recibe un alfa sin haberlo pedido — y sin ninguna señal de
 * que sea un alfa. Por eso los prereleases viven en su propio tag, y
 * `latest` sólo lo ocupa la release.
 */
export const RELEASE_DIST_TAGS: Readonly<Record<ReleaseChannel, string>> = {
  alpha: "alpha",
  beta: "beta",
  rc: "rc",
  stable: "latest",
};

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
