/**
 * El registro de secciones.
 *
 * Es la pieza de la que cuelgan vitest, el typecheck y `test:changed`,
 * así que un fallo aquí no rompe un test: hace que el gate deje de
 * mirar una carpeta sin avisar. Por eso se comprueba el mapeo caso a
 * caso y no solo "devuelve algo".
 */
import { describe, expect, test } from "vitest";

import {
  GLOBAL_PATHS,
  SECTIONS,
  bestSectionFor,
  sectionByName,
  sectionsForFiles,
  withDependents,
} from "../../scripts/gates/sections.constant";

describe("SECTIONS", () => {
  test("los nombres son únicos", () => {
    const names = SECTIONS.map((section) => section.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("toda dependencia declarada existe", () => {
    for (const section of SECTIONS) {
      for (const dependency of section.dependsOn) {
        expect(sectionByName(dependency), `${section.name} → ${dependency}`).toBeDefined();
      }
    }
  });

  test("el núcleo no depende de nadie: es lo que lo mantiene agnóstico", () => {
    expect(sectionByName("core")?.dependsOn).toEqual([]);
  });

  test("no hay ciclos en el grafo de dependencias", () => {
    // Si lo hubiera, `withDependents` no terminaría o devolvería de más.
    for (const section of SECTIONS) {
      const reach = withDependents([section]).map((s) => s.name);
      expect(reach).toContain(section.name);
      expect(new Set(reach).size).toBe(reach.length);
    }
  });
});

describe("bestSectionFor — gana el prefijo más específico", () => {
  test.each([
    ["projects/core/domain/collection-builder.service.ts", "core"],
    ["projects/core/helpers/uri.helper.ts", "core"],
    ["projects/core/contracts/postman.interface.ts", "core"],
    // Los scanners y los parsers de cada framework viven fuera del
    // núcleo desde que se separaron las dos capas.
    ["projects/frameworks/scanners/gin.scanner.ts", "frameworks"],
    ["projects/frameworks/laravel/laravel.scanner.ts", "frameworks"],
    ["projects/frameworks/parsers/zod-schema.helper.ts", "frameworks"],
    ["projects/frameworks/framework.registry.ts", "frameworks"],
    // El adapter sí es del núcleo: trabaja sobre el contrato genérico
    // `ParsedRoute`, no sobre ningún framework concreto.
    ["projects/core/adapters/parsed-route-to-spec.adapter.ts", "core"],
    ["projects/cli/commands/generate.script.ts", "cli"],
    ["examples/example-express/src/index.js", "e2e"],
    ["projects/plugins/mcp-vertex_expostman/src/index.ts", "plugin"],
  ])("%s → %s", (file, expected) => {
    expect(bestSectionFor(file)?.name).toBe(expected);
  });

  test("un fichero fuera de toda sección no cae en ninguna", () => {
    expect(bestSectionFor("README.md")).toBeUndefined();
    expect(bestSectionFor("docs/INSTALL.md")).toBeUndefined();
  });
});

describe("sectionsForFiles", () => {
  test("un scanner solo activa frameworks", () => {
    expect(
      sectionsForFiles(["projects/frameworks/scanners/flask.scanner.ts"]).map((s) => s.name),
    ).toEqual(["frameworks"]);
  });

  test("varios ficheros activan varias secciones, sin repetir", () => {
    const names = sectionsForFiles([
      "projects/frameworks/scanners/flask.scanner.ts",
      "projects/frameworks/scanners/gin.scanner.ts",
      "projects/cli/commands/push.script.ts",
    ]).map((s) => s.name);
    expect(names).toEqual(["frameworks", "cli"]);
  });

  test.each(GLOBAL_PATHS.map((path) => [path]))(
    "tocar %s obliga a correrlo todo",
    (globalPath) => {
      const file = globalPath.endsWith("/") ? `${globalPath}algo.ts` : globalPath;
      expect(sectionsForFiles([file]).length).toBe(SECTIONS.length);
    },
  );

  test("cambiar solo documentación no activa ninguna sección", () => {
    expect(sectionsForFiles(["README.md", "docs/POSTMAN.md"])).toEqual([]);
  });
});

describe("withDependents", () => {
  test("tocar el núcleo arrastra a todos sus consumidores", () => {
    const names = withDependents([sectionByName("core")!]).map((s) => s.name);
    expect(names).toEqual(["core", "frameworks", "cli", "e2e", "plugin"]);
  });

  test("tocar un scanner no arrastra al núcleo", () => {
    const names = withDependents([sectionByName("frameworks")!]).map((s) => s.name);
    expect(names).not.toContain("core");
    expect(names).toContain("frameworks");
    expect(names).toContain("e2e");
  });

  test("la hoja del grafo no arrastra nada más", () => {
    expect(withDependents([sectionByName("e2e")!]).map((s) => s.name)).toEqual(["e2e"]);
  });

  test("se conserva el orden declarado, no el de descubrimiento", () => {
    const names = withDependents([sectionByName("cli")!, sectionByName("core")!]).map(
      (s) => s.name,
    );
    expect(names).toEqual(SECTIONS.filter((s) => names.includes(s.name)).map((s) => s.name));
  });
});
