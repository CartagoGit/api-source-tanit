/**
 * El canal de una versión, y las tres copias de la versión.
 *
 * ## Por qué esto tiene test y no sólo un gate
 *
 * El gate dice que **hoy** las tres copias coinciden. El test dice por
 * qué tienen que coincidir, y qué pasa cuando dejan de hacerlo. Un
 * gate que falla te dice *qué* está mal; el test te dice *por qué*
 * estaba bien antes.
 *
 * ## Las tres copias
 *
 *   · `package.json` — lo que describe el producto que se publica.
 *   · `packages/contracts/constants/cli/cli-version.constant.ts` — lo
 *     que imprime `apisrc --version`.
 *   · `packages/desktop/tauri.conf.json` — lo que ponen los
 *     instaladores.
 *
 * ## El canal
 *
 * El prefijo de prerelease decide el canal, y el canal decide si la
 * release se marca como prerelease. Un alfa marcado como release
 * estable se lo traga cualquiera que busque la última versión, así que
 * esa parte también se prueba.
 */
import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper.js";
import {
  channelOf,
  isPrereleaseVersion,
  isSemver,
} from "../../scripts/helpers/release-channel.helper.js";
import { CLI_VERSION } from "../../packages/contracts/constants/cli/cli-version.constant.js";
import {
  RELEASE_CHANNELS,
  STABLE_RELEASE_CHANNEL,
} from "../../packages/contracts/constants/release/release-channel.constant.js";

async function readJson(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(REPO_ROOT, path), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("el canal de una versión", () => {
  test("sin prefijo de prerelease es el canal estable", () => {
    expect(channelOf("1.0.0")).toBe(STABLE_RELEASE_CHANNEL);
    expect(channelOf("0.9.3")).toBe(STABLE_RELEASE_CHANNEL);
  });

  test("el prefijo decide el canal", () => {
    expect(channelOf("0.1.0-alpha.1")).toBe("alpha");
    expect(channelOf("0.2.0-beta.3")).toBe("beta");
    expect(channelOf("0.9.0-rc.1")).toBe("rc");
  });

  test("el número de la prerelease no cambia el canal", () => {
    expect(channelOf("0.1.0-alpha.1")).toBe(channelOf("0.1.0-alpha.97"));
  });

  test("un prefijo que no es de ningún canal no tiene canal", () => {
    expect(channelOf("0.1.0-gamma.1")).toBeNull();
    expect(channelOf("0.1.0-nightly.1")).toBeNull();
  });

  test("una versión que no es semver no tiene canal", () => {
    expect(channelOf("uno")).toBeNull();
    expect(channelOf("1.0")).toBeNull();
    expect(channelOf("")).toBeNull();
    expect(isSemver("1.0")).toBe(false);
    expect(isSemver("1.0.0")).toBe(true);
  });
});

describe("la marca de prerelease", () => {
  test("sólo el canal estable es una release normal", () => {
    expect(isPrereleaseVersion("1.0.0")).toBe(false);
    expect(isPrereleaseVersion("0.9.3")).toBe(false);
  });

  test("cualquier prerelease se marca como tal", () => {
    for (const channel of RELEASE_CHANNELS) {
      if (channel === STABLE_RELEASE_CHANNEL) continue;
      expect(isPrereleaseVersion(`0.1.0-${channel}.1`)).toBe(true);
    }
  });

  test("la marca sale del canal de la versión", () => {
    expect(isPrereleaseVersion("0.1.0-alpha.1")).toBe(true);
    expect(isPrereleaseVersion("0.2.0-beta.3")).toBe(true);
    expect(isPrereleaseVersion("0.9.0-rc.1")).toBe(true);
    expect(isPrereleaseVersion("1.0.0")).toBe(false);
  });

  test("una versión sin canal no se puede marcar", () => {
    expect(isPrereleaseVersion("0.1.0-gamma.1")).toBeNull();
    expect(isPrereleaseVersion("no-es-una-version")).toBeNull();
  });
});

describe("las tres copias de la versión", () => {
  test("el paquete, el CLI y el instalador dicen lo mismo", async () => {
    const pkg = await readJson("package.json");
    const tauri = await readJson("packages/desktop/tauri.conf.json");
    expect(pkg.version).toBe(CLI_VERSION);
    expect(tauri.version).toBe(CLI_VERSION);
  });

  test("la versión es semver y pertenece a un canal", () => {
    expect(isSemver(CLI_VERSION)).toBe(true);
    expect(channelOf(CLI_VERSION)).not.toBeNull();
  });
});
