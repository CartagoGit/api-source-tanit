/**
 * Los workflows de release los dispara el **tag**, no el evento
 * `release`.
 *
 * ## Por qué esto tiene test
 *
 * Porque el fallo es invisible. `release-cut` crea la release con
 * `GITHUB_TOKEN`, y **los eventos que dispara el propio
 * `GITHUB_TOKEN` no crean ejecuciones nuevas**. Con los workflows
 * escuchando a `release: [published, prereleased]`, la release se
 * creaba correctamente —con sus notas y su marca de prerelease— y
 * **nadie adjuntaba los binarios**. Ni un check fallaba, ni una
 * línea del log lo decía: la release salía vacía y todo parecía
 * estar bien.
 *
 * Ese fallo ya pasó una vez: la release `v0.1.0-alpha.1` salió sin
 * un solo ejecutable adjunto.
 *
 * ## La regla
 *
 * Los tres workflows de release —`release-cut`, `release-binaries` y
 * `release-desktop`— escuchan el tag. El tag lo empuja una persona,
 * y eso es lo que GitHub dispara aunque el workflow anterior haya
 * usado `GITHUB_TOKEN`.
 */
import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper.js";

const WORKFLOWS = join(REPO_ROOT, ".github", "workflows");

/** Los tres workflows que participan en una release. */
const RELEASE_WORKFLOWS = [
  "release-cut.yml",
  "release-binaries.yml",
  "release-desktop.yml",
] as const;

async function workflow(name: string): Promise<string> {
  return readFile(join(WORKFLOWS, name), "utf8");
}

/** El workflow sin sus comentarios, para no leer lo que dice de sí. */
function withoutComments(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

describe("los workflows de release", () => {
  test("los tres existen", async () => {
    for (const name of RELEASE_WORKFLOWS) {
      await expect(workflow(name)).resolves.toContain("name: release");
    }
  });

  test("ninguno escucha el evento `release`", async () => {
    for (const name of RELEASE_WORKFLOWS) {
      const raw = withoutComments(await workflow(name));
      // `release:` como clave del trigger es el evento. Si aparece,
      // el workflow depende de un evento que `GITHUB_TOKEN` no emite.
      expect(raw, `${name} escucha el evento release`).not.toMatch(
        /^\s{2}release:\s*$/m,
      );
    }
  });

  test("los tres escuchan el tag", async () => {
    for (const name of RELEASE_WORKFLOWS) {
      const raw = withoutComments(await workflow(name));
      expect(raw, `${name} no escucha el tag`).toMatch(/^\s{2}push:\s*$/m);
      expect(raw, `${name} no filtra por tags`).toMatch(/^\s{4}tags:\s*$/m);
      expect(raw, `${name} no declara el patrón del tag`).toContain(
        '"v*.*.*"',
      );
    }
  });

  test("nadie lee `github.event.release`", async () => {
    for (const name of RELEASE_WORKFLOWS) {
      const raw = withoutComments(await workflow(name));
      // El payload del evento `release` ya no llega: el workflow
      // corre por el tag, y su payload es el del push.
      expect(raw, `${name} lee el evento release`).not.toContain(
        "github.event.release",
      );
    }
  });

  test("los tres se traen la historia entera", async () => {
    for (const name of RELEASE_WORKFLOWS) {
      const raw = await workflow(name);
      // El gate `lint:proposals` audita la historia: exige que cada
      // `shippedIn` de una propuesta cerrada sea ancestro de HEAD. Un
      // checkout sin historial —el defecto de `actions/checkout`— le
      // deja al gate 223 referencias inalcanzables, y la release
      // falla **antes de compilar un solo binario**.
      expect(raw, `${name} no se trae la historia`).toContain(
        "fetch-depth: 0",
      );
    }
  });

  test("el que corta la release la actualiza si ya existe", async () => {
    const raw = await workflow("release-cut.yml");
    // Un tag puede volver a empujarse —por ejemplo, cuando la
    // release salió vacía por un fallo del workflow de binarios— y en
    // ese caso las notas y la marca tienen que volver a quedar como
    // deben. Si `gh release create` falla, el workflow se pone rojo y
    // la release se queda como estaba.
    expect(raw).toContain("gh release edit");
    expect(raw).toContain("gh release view");
  });

  test("el que adjunta espera a que la release exista", async () => {
    for (const name of ["release-binaries.yml", "release-desktop.yml"]) {
      const raw = await workflow(name);
      // Sin la espera, adjuntar es un error de forma: la release la
      // crea `release-cut`, que corre en paralelo.
      expect(raw, `${name} no espera a la release`).toContain(
        "gh release view",
      );
    }
  });

  test("nadie sube los assets con una acción que cree la release", async () => {
    const raw = withoutComments(await workflow("release-binaries.yml"));
    // La acción `softprops/action-gh-release` **crea** la release si
    // no existe. Aquí la release ya existe, con sus notas y su marca
    // de prerelease: crearla otra vez por error la pisaría.
    expect(raw).not.toContain("softprops/action-gh-release");
    expect(raw).toContain("gh release upload");
  });
});
