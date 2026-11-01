#!/usr/bin/env bun
/**
 * `bun run lint:release-channel` — una sola versión, un solo canal.
 *
 * ## Por qué hace falta
 *
 * La versión del producto vive en tres sitios que no comparten código:
 * el `package.json` que se publica en npm, la constante que imprime
 * `apisrc --version` y la que lee Tauri para los instaladores. Son tres
 * copias de un mismo hecho, y si una se queda atrás el producto miente
 * en tres formatos distintos: el binario dice una cosa, el paquete
 * otra, y el instalador otra.
 *
 * A eso se suma el **canal**. El número dice qué hay; el canal dice
 * cuánto se puede esperar. Publicar un alfa como `1.0.0` promete una
 * estabilidad que no existe, y publicar un alfa en el `dist-tag`
 * `latest` se lo traga a cualquiera que instale sin pedirlo.
 *
 * ## Qué comprueba
 *
 *   1. Las tres copias de la versión son la misma.
 *   2. La versión tiene forma de semver, con o sin prefijo.
 *   3. El prefijo de prerelease es uno de los del canal: `alpha`,
 *      `beta` o `rc`. Sin prefijo, la versión es del canal estable.
 *   4. El `dist-tag` de npm es el que le toca a ese canal.
 *
 * ## El `--print-tag`
 *
 * El workflow de publicación necesita el `dist-tag` y no puede
 * duplicar esta lógica: si la duplica, un día se desincroniza del gate
 * y el gate deja de decir la verdad. Con `--print-tag` el gate **es**
 * la fuente y el workflow sólo pregunta.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT } from "../helpers/root.helper.js";
import {
  channelOf,
  distTagOf,
  isSemver,
} from "../helpers/release-channel.helper.js";
import { CLI_VERSION } from "../../packages/contracts/constants/cli/cli-version.constant.js";

async function readJson(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(REPO_ROOT, path), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

export async function main(): Promise<number> {
  const printTag = process.argv.includes("--print-tag");
  const problems: string[] = [];

  const pkg = await readJson("package.json");
  const version = readString(pkg, "version");
  const tauri = await readJson("packages/desktop/tauri.conf.json");
  const tauriVersion = readString(tauri, "version");

  // 1. Las tres copias dicen lo mismo.
  if (version !== CLI_VERSION) {
    problems.push(
      `package.json dice "${version}" y CLI_VERSION dice "${CLI_VERSION}"`,
    );
  }
  if (tauriVersion !== CLI_VERSION) {
    problems.push(
      `packages/desktop/tauri.conf.json dice "${tauriVersion}" y CLI_VERSION dice "${CLI_VERSION}"`,
    );
  }

  // 2. La versión tiene forma de semver.
  if (!isSemver(version)) {
    problems.push(`"${version}" no es una versión semver`);
  }

  // 3. El prefijo pertenece a un canal conocido.
  const channel = channelOf(version);
  if (channel === null) {
    problems.push(
      `"${version}" no dice a qué canal pertenece: los prefijos válidos son ` +
        `alpha, beta y rc`,
    );
  }

  // 4. El dist-tag es el del canal.
  const publishConfig = (pkg.publishConfig ?? {}) as Record<string, unknown>;
  const declaredTag = readString(publishConfig, "tag");
  const expectedTag = distTagOf(version) ?? "";
  if (declaredTag !== expectedTag) {
    problems.push(
      `publishConfig.tag dice "${declaredTag || "(nada)"}" y el canal ` +
        `"${channel ?? "desconocido"}" necesita "${expectedTag}"`,
    );
  }

  if (problems.length > 0) {
    console.error(`lint:release-channel — ${problems.length} problema(s):\n`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error(
      "\n  La versión del producto vive en tres ficheros. Si discrepan,\n" +
        "  el binario, el paquete de npm y el instalador dicen cosas\n" +
        "  distintas. Súbenlas a la vez y vuelve a pasar este gate.",
    );
    return 1;
  }

  if (printTag) {
    console.log(expectedTag);
    return 0;
  }

  console.log(
    `lint:release-channel — ${version} (canal ${channel}, dist-tag ${expectedTag}): ` +
      "las tres copias coinciden.",
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
