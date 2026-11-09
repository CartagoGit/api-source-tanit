/**
 * La versión del CLI no se queda vieja, y la app de escritorio va con
 * ella.
 *
 * ## Por qué hace falta
 *
 * El sidecar que viaja dentro de la app de escritorio es el CLI. Si
 * los dos tuvieran versiones distintas, la app y su sidecar dejarían
 * de hablar del mismo producto: el smoke del updater lo comprueba, y
 * este test es lo que hace que el fallo aparezca **antes** de la
 * release y no en la instalación de un usuario.
 *
 * ## De dónde sale cada versión
 *
 *   · La del CLI, de `CLI_VERSION` —el mismo valor que imprime
 *     `apisrc --version`.
 *   · La del paquete publicado, de `package.json`.
 *   · La de la app, de `packages/desktop/tauri.conf.json`.
 *
 * Si alguien sube una y no la otra, este test falla.
 */
import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper.js";
import { CLI_VERSION } from "../../packages/contracts/constants/cli/cli-version.constant.js";

/** Lee la versión de un `package.json`. */
async function readVersion(path: string): Promise<string | undefined> {
  const raw = await readFile(join(REPO_ROOT, path), "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version;
}

describe("la versión del CLI", () => {
  test("es la misma que la del paquete publicado", async () => {
    expect(await readVersion("package.json")).toBe(CLI_VERSION);
  });

  test("es la misma que la de la app de escritorio", async () => {
    expect(await readVersion("packages/desktop/tauri.conf.json")).toBe(CLI_VERSION);
  });
});
