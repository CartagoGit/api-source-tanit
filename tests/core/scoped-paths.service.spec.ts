/**
 * `withScopedPaths` — fijar las rutas para un tramo de ejecución.
 *
 * Las rutas se resuelven leyendo `process.argv` y `process.env`, no
 * argumentos de función. Eso vale para el CLI, donde cada comando es su
 * propio proceso, pero no para quien invoca un comando **dentro** del
 * mismo proceso: el asistente interactivo le pasaba `--output-dir` a
 * `generate` en un array, y `outputDir()` seguía mirando el argv del
 * asistente. La carpeta que elegía quien estaba delante se aceptaba, se
 * mostraba, y se ignoraba.
 *
 * Este spec conserva la compatibilidad de la fachada: que el scope se vea,
 * que se restaure y que el anidamiento no cuelgue el proceso. La concurrencia
 * real se prueba en el pipeline, que ya recibe `IProjectContext` explícito.
 */
import { afterEach, describe, expect, test } from "vitest";
import { resolve } from "node:path";

import { outputDir, resetPathCache, withProjectRoot, withScopedPaths } from "../../packages/core/discovery/paths.service";

describe("withScopedPaths", () => {
  afterEach(() => {
    delete process.env["POSTMAN_PROJECT_ROOT"];
    delete process.env["POSTMAN_OUTPUT_DIR"];
    resetPathCache();
  });

  test("dentro de la sección, outputDir() es el del scope", async () => {
    const seen = await withScopedPaths({ outputDir: "/tmp/elegido" }, async () =>
      outputDir(),
    );
    expect(seen).toBe(resolve("/tmp/elegido"));
  });

  test("al salir, restaura lo que hubiera antes", async () => {
    process.env["POSTMAN_OUTPUT_DIR"] = "/tmp/previo";
    await withScopedPaths({ outputDir: "/tmp/otro" }, async () => undefined);
    expect(process.env["POSTMAN_OUTPUT_DIR"]).toBe("/tmp/previo");
  });

  test("si no había nada antes, no deja la variable puesta", async () => {
    await withScopedPaths({ outputDir: "/tmp/otro" }, async () => undefined);
    expect(process.env["POSTMAN_OUTPUT_DIR"]).toBeUndefined();
  });

  test("restaura también cuando `fn` lanza", async () => {
    process.env["POSTMAN_OUTPUT_DIR"] = "/tmp/previo";
    await expect(
      withScopedPaths({ outputDir: "/tmp/otro" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(process.env["POSTMAN_OUTPUT_DIR"]).toBe("/tmp/previo");
  });

  test("lo que no se pasa en el scope no se toca", async () => {
    process.env["POSTMAN_PROJECT_ROOT"] = "/tmp/raiz";
    await withScopedPaths({ outputDir: "/tmp/salida" }, async () => {
      expect(process.env["POSTMAN_PROJECT_ROOT"]).toBe("/tmp/raiz");
    });
  });

  test("fija las dos rutas a la vez", async () => {
    await withScopedPaths(
      { projectRoot: "/tmp/raiz", outputDir: "/tmp/salida" },
      async () => {
        expect(process.env["POSTMAN_PROJECT_ROOT"]).toBe(resolve("/tmp/raiz"));
        expect(outputDir()).toBe(resolve("/tmp/salida"));
      },
    );
  });

  /** La fachada legacy debe seguir admitiendo scopes anidados. */
  test("anidar secciones no se bloquea", { timeout: 2_000 }, async () => {
    const seen = await withProjectRoot("/tmp/raiz", async () =>
      withScopedPaths({ outputDir: "/tmp/dentro" }, async () => outputDir()),
    );
    expect(seen).toBe(resolve("/tmp/dentro"));
  });

  test("la sección de dentro no se lleva por delante la de fuera", async () => {
    await withScopedPaths({ outputDir: "/tmp/fuera" }, async () => {
      await withScopedPaths({ outputDir: "/tmp/dentro" }, async () => {
        expect(outputDir()).toBe(resolve("/tmp/dentro"));
      });
      expect(outputDir()).toBe(resolve("/tmp/fuera"));
    });
  });

});
