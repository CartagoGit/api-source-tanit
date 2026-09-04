/**
 * El registro de rutas del repo.
 *
 * Este spec es la razón de ser de `root.helper.ts`. El registro por sí
 * solo no arregla nada: sería otro sitio donde una ruta puede quedarse
 * vieja en silencio. Lo que lo arregla es **comprobar que todo lo que
 * declara existe**, para que mover una carpeta rompa el gate en vez de
 * dejar un lint diciendo "no se encontró ninguna propuesta" como si el
 * repo estuviera vacío.
 *
 * Eso pasó tres veces durante la reorganización, y las tres fueron
 * silenciosas: una ruta equivocada no lanza, simplemente no encuentra.
 */
import { describe, expect, test } from "vitest";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import {
  CLI_ENTRYPOINT,
  EXAMPLES_DIR,
  DELENDAI_PLUGIN_DIR,
  PROPOSALS_DIR,
  REPO_ROOT,
  WELL_KNOWN_PATHS,
  comprehensiveFixtureDir,
  exampleDir,
  fromRoot,
  pluginDir,
  smokeFixtureDir,
} from "../../scripts/helpers/root.helper";
import { FRAMEWORK_IDS } from "../../packages/contracts/constants/frameworks/framework-ids.constant";

describe("WELL_KNOWN_PATHS", () => {
  // El test que importa: si alguien mueve una carpeta y no toca el
  // registro, esto falla nombrando la constante exacta.
  test.each(Object.entries(WELL_KNOWN_PATHS))("%s existe en disco", (_name, path) => {
    expect(existsSync(path)).toBe(true);
  });

  test("todas son absolutas", () => {
    for (const [name, path] of Object.entries(WELL_KNOWN_PATHS)) {
      expect(isAbsolute(path), name).toBe(true);
    }
  });

  test("todas cuelgan de la raíz del repo", () => {
    for (const [name, path] of Object.entries(WELL_KNOWN_PATHS)) {
      expect(path.startsWith(REPO_ROOT), `${name} = ${path}`).toBe(true);
    }
  });

  test("no hay dos constantes apuntando al mismo sitio", () => {
    const paths = Object.values(WELL_KNOWN_PATHS);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("REPO_ROOT", () => {
  // La búsqueda exige package.json Y delendai.config.json juntos: con
  // solo el primero pararía en `packages/plugins/delendai_tanit`, que
  // también tiene el suyo.
  test("es la raíz de verdad, no la de un paquete de dentro", () => {
    expect(existsSync(join(REPO_ROOT, "package.json"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "delendai.config.json"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "packages"))).toBe(true);
  });

  test("el plugin también tiene package.json, y no es la raíz", () => {
    expect(existsSync(join(DELENDAI_PLUGIN_DIR, "package.json"))).toBe(true);
    expect(DELENDAI_PLUGIN_DIR).not.toBe(REPO_ROOT);
  });
});

describe("fromRoot", () => {
  test("compone desde la raíz", () => {
    expect(fromRoot("docs")).toBe(join(REPO_ROOT, "docs"));
  });

  test("acepta varios segmentos", () => {
    expect(fromRoot("packages", "core")).toBe(join(REPO_ROOT, "packages", "core"));
  });

  test("sin segmentos devuelve la raíz", () => {
    expect(fromRoot()).toBe(REPO_ROOT);
  });
});

describe("rutas parametrizadas", () => {
  test("el entrypoint del CLI es un fichero, no una carpeta", () => {
    expect(statSync(CLI_ENTRYPOINT).isFile()).toBe(true);
  });

  test.each([...FRAMEWORK_IDS])(
    "%s tiene su fixture completo y su fixture mínimo",
    (framework) => {
      expect(existsSync(comprehensiveFixtureDir(framework)), "comprehensive").toBe(true);
      expect(existsSync(smokeFixtureDir(framework)), "smoke").toBe(true);
    },
  );

  test.each([...FRAMEWORK_IDS])("%s tiene su proyecto de ejemplo", (framework) => {
    // `openapi` es el único cuyo ejemplo no sigue el patrón del nombre:
    // se llama `example-openapi-headers` porque lo que ejercita son las
    // cabeceras del spec.
    const expected = framework === "openapi" ? join(EXAMPLES_DIR, "example-openapi-headers") : exampleDir(framework);
    expect(existsSync(expected), expected).toBe(true);
  });

  test("pluginDir compone bajo plugins/", () => {
    expect(pluginDir("delendai_tanit")).toBe(DELENDAI_PLUGIN_DIR);
  });

  test("las propuestas están donde dice el registro", () => {
    expect(existsSync(join(PROPOSALS_DIR, "ready"))).toBe(true);
    expect(existsSync(join(PROPOSALS_DIR, "done"))).toBe(true);
  });
});
