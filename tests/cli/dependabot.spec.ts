/**
 * Qué mira Dependabot y qué no.
 *
 * Este repo contiene **50 manifiestos que no son suyos**: cada proyecto
 * de `examples/` y cada fixture trae su `package.json`,
 * `requirements.txt`, `go.mod` o `Cargo.toml`, porque es de ahí de donde
 * los scanners deducen el framework. Son proyectos de mentira y nadie
 * los instala.
 *
 * Dependabot no puede saberlo. Se midió al fusionar `develop` en `main`:
 * las alertas pasaron de 43 a 67 —seis críticas— mientras `bun audit`
 * sobre lo que sí se instala seguía en cero. Los ejemplos de GraphQL y
 * tRPC, dos ficheros con cuatro dependencias declaradas, aportaron 24
 * ellos solos.
 *
 * Eso no es seguridad, es ruido que **esconde** los avisos de verdad.
 *
 * Los dos fallos posibles son simétricos y este spec cubre los dos: que
 * un paquete real se quede sin vigilar, y que un manifiesto de mentira
 * vuelva a entrar.
 */
import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REPO_ROOT } from "../../scripts/helpers/root.helper";

/** Los `directory:` declarados en la configuración. */
async function declaredDirectories(): Promise<string[]> {
  const raw = await readFile(join(REPO_ROOT, ".github", "dependabot.yml"), "utf8");
  return [...raw.matchAll(/^\s*directory:\s*"([^"]+)"/gm)].map((m) => m[1] ?? "");
}

/** Los paquetes que este repo instala de verdad. */
async function realPackages(): Promise<string[]> {
  const pkg = JSON.parse(
    await readFile(join(REPO_ROOT, "package.json"), "utf8"),
  ) as { workspaces?: string[] };
  // La raíz más cada miembro del workspace. Un workspace es, por
  // definición, un paquete que `bun install` resuelve.
  return ["/", ...(pkg.workspaces ?? []).map((w) => `/${w}`)];
}

describe("configuración de Dependabot", () => {
  test("existe", async () => {
    await expect(
      readFile(join(REPO_ROOT, ".github", "dependabot.yml"), "utf8"),
    ).resolves.toContain("version: 2");
  });

  // Un paquete real sin vigilar es una dependencia que envejece sola.
  test("cubre todos los paquetes que se instalan de verdad", async () => {
    const declared = await declaredDirectories();
    for (const dir of await realPackages()) {
      expect(declared, `falta ${dir}`).toContain(dir);
    }
  });

  /**
   * El fallo simétrico: si alguien añade `examples/` a la lista para
   * "cubrirlo todo", vuelven las decenas de alertas de dependencias que
   * no existen, y con ellas el ruido que esconde las reales.
   */
  test("no vigila los manifiestos de mentira", async () => {
    for (const dir of await declaredDirectories()) {
      expect(dir, `${dir} no es un paquete de este repo`).not.toMatch(
        /^\/(examples|tests)\b/,
      );
    }
  });

  test("las acciones del workflow también se vigilan", async () => {
    const raw = await readFile(join(REPO_ROOT, ".github", "dependabot.yml"), "utf8");
    // Una acción vieja es código de terceros ejecutándose con el token
    // del repositorio.
    expect(raw).toContain("github-actions");
  });

  test("dice por qué existe, no solo qué hace", async () => {
    const raw = await readFile(join(REPO_ROOT, ".github", "dependabot.yml"), "utf8");
    expect(raw).toContain("examples/");
    expect(raw.split("\n").filter((l) => l.startsWith("#")).length).toBeGreaterThan(10);
  });
});
