/**
 * De una versión a su canal, y de su canal a cómo se corta la release.
 *
 * ## Por qué vive aquí y no en los contratos
 *
 * Porque es **tooling de release**, no superficie del producto: lo
 * usan el gate que valida la versión, el workflow que corta la release
 * y el test que lo fija. Los contratos se quedan con los datos —los
 * nombres de los canales y su prefijo— y esta función los convierte.
 *
 * ## La regla
 *
 * El prefijo de prerelease decide el canal, no al revés:
 *
 *   · `0.1.0-alpha.1` → canal `alpha`, release marcada como prerelease.
 *   · `0.2.0-beta.3`  → canal `beta`, release marcada como prerelease.
 *   · `0.9.0-rc.1`    → canal `rc`, release marcada como prerelease.
 *   · `1.0.0`         → canal estable, release normal.
 *
 * Una versión sin prefijo es siempre la estable: es la única forma
 * que se puede instalar sin pedir un canal a mano.
 */

import {
  RELEASE_CHANNELS,
  RELEASE_PRERELEASE_TAGS,
  STABLE_RELEASE_CHANNEL,
} from "../../packages/contracts/constants/release/release-channel.constant.js";
import type { ReleaseChannel } from "../../packages/contracts/interfaces/release/release-channel.interface.js";

/** Semver con prefijo opcional de prerelease y de build. */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/**
 * Los canales que se declaran con un prefijo de prerelease.
 *
 * Se derivan de la lista del contrato en vez de escribirla otra vez:
 * dos listas de canales en dos ficheros es una forma segura de que
 * uno se quede viejo sin que nada lo note.
 */
const PRERELEASE_CHANNELS = RELEASE_CHANNELS.filter(
  (channel): channel is Exclude<ReleaseChannel, "stable"> =>
    channel !== STABLE_RELEASE_CHANNEL,
);

/** Si la versión tiene forma de semver. */
export function isSemver(version: string): boolean {
  return SEMVER.test(version);
}

/**
 * El canal de una versión, o `null` si no se puede decidir.
 *
 * `null` significa dos cosas distintas y el gate las distingue: que la
 * versión no es semver, o que su prefijo no pertenece a ningún canal.
 */
export function channelOf(version: string): ReleaseChannel | null {
  const match = SEMVER.exec(version);
  if (!match) return null;
  const prerelease = match[4];
  if (!prerelease) return STABLE_RELEASE_CHANNEL;
  const identifier = prerelease.split(".")[0] ?? "";
  for (const channel of PRERELEASE_CHANNELS) {
    if (RELEASE_PRERELEASE_TAGS[channel] === identifier) return channel;
  }
  return null;
}

/**
 * Si una versión es un prerelease, y por tanto su release se marca
 * como tal.
 *
 * `null` cuando el canal no se puede deducir: marcar una release como
 * prerelease o como estable sin saberlo es peor que no publicarla.
 */
export function isPrereleaseVersion(version: string): boolean | null {
  const channel = channelOf(version);
  if (channel === null) return null;
  return channel !== STABLE_RELEASE_CHANNEL;
}
