/**
 * El catálogo y el registro dicen lo mismo.
 *
 * `FRAMEWORK_IDS` vive en contratos y es una lista literal; el registro
 * de scanners es quien la cumple. Esa dirección es deliberada: derivar
 * la lista del registro obligaba a importar los veintiún scanners —con
 * sus parsers de PHP, Go, Java, Python y Rust— para leer veintiún
 * strings. El plugin MCP lo hacía solo para declarar un `z.enum`.
 *
 * El precio de invertirlo es tener dos listas, y este repositorio ya
 * sabe cómo acaba eso: `NON_LARAVEL_FRAMEWORKS` enumeraba once de doce
 * frameworks, Laravel no estaba, y `summary` se iba por un camino
 * distinto contando rutas declaradas en vez de endpoints. Decía 7 donde
 * el pipeline encuentra 17.
 *
 * Lo que hacía peligrosa aquella lista no era existir: era que **nadie
 * la comparaba**. Este fichero es esa comparación.
 */
import { describe, expect, test } from "vitest";

import { FRAMEWORK_IDS } from "../../projects/contracts/constants/frameworks/framework-ids.constant";
import { registeredFrameworkIds } from "../../projects/frameworks/framework.registry";

describe("el catálogo y el registro", () => {
  /** EL test: ni sobra ni falta ninguno, en ninguno de los dos lados. */
  test("declaran exactamente los mismos frameworks", () => {
    const catalogo = [...FRAMEWORK_IDS].sort();
    const registrados = [...registeredFrameworkIds()].sort();

    expect(registrados, "el registro tiene alguno que el catálogo no declara").toEqual(
      catalogo,
    );
  });

  test("el catálogo no repite ninguno", () => {
    expect(new Set(FRAMEWORK_IDS).size).toBe(FRAMEWORK_IDS.length);
  });

  test("el registro tampoco: dos detectores con el mismo id se pisan", () => {
    const ids = registeredFrameworkIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * El orden alfabético no es estético: hace que añadir un framework sea
   * una línea de diff en vez de un bloque reordenado, y que revisarlo
   * sea leer una línea.
   */
  test("el catálogo va en orden alfabético", () => {
    expect([...FRAMEWORK_IDS]).toEqual([...FRAMEWORK_IDS].sort());
  });

  /**
   * Leer el catálogo no puede costar cargar los scanners. Es la razón de
   * ser de todo esto, así que se comprueba sobre el texto del fichero:
   * si alguien le añade un import a `frameworks/`, esto lo dice.
   */
  test("el catálogo no importa nada", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const aqui = dirname(fileURLToPath(import.meta.url));
    const fuente = await readFile(
      join(
        aqui,
        "..",
        "..",
        "projects",
        "contracts",
        "constants",
        "frameworks",
        "framework-ids.constant.ts",
      ),
      "utf8",
    );
    const sinComentarios = fuente
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(sinComentarios).not.toMatch(/^import\s/m);
  });
});
