/**
 * De una versión a su canal, y de su canal al `dist-tag` de npm.
 *
 * ## Por qué vive aquí y no en los contratos
 *
 * Porque es **tooling de release**, no superficie del producto: lo
 * usan el gate que valida la versión, el workflow que publica en npm
 * y el test que lo fija. Los contratos se quedan con los datos —los
 * nombres de los canales y su `dist-tag`— y esta función los
 * convierte.
 *
 * ## La regla
 *
 * El prefijo de prerelease decide el canal, no al revés:
 *
 *   · `0.1.0-alpha.1` → canal `alpha`, se publica en `alpha`.
 *   · `0.2.0-beta.3`  → canal `beta`, se publica en `beta`.
 *   · `0.9.0-rc.1`    → canal `rc`, se publica en `rc`.
 *   · `1.0.0`         → canal estable, se publica en `latest`.
 *
 * Una versión sin prefijo es siempre la estable: es la única forma
 * que se puede instalar sin pedir un canal a mano.
 */

import {
  RELEASE_DIST_TAGS,
  RELEASE_PRERELEASE_TAGS,
  STABLE_RELEASE_CHANNEL,
} from "../../packages/contracts/constants/release/release-channel.constant.js";
import type { ReleaseChannel } from "../../packages/contracts/interfaces/release/release-channel.interface.js";

/** Semver con prefijo opcional de prerelease y de build. */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/** Los canales que se declaran con un prefijo de prerelease. */
const PRERELEASE_CHANNELS = ["alpha", "beta", "rc"] as const;

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
 * El `dist-tag` de npm de una versión, o `null` si no se puede decidir.
 *
 * `null` cuando el canal no se puede deducir: publicar con un tag
 * inventado es peor que no publicar.
 */
export function distTagOf(version: string): string | null {
  const channel = channelOf(version);
  if (channel === null) return null;
  return RELEASE_DIST_TAGS[channel];
}
