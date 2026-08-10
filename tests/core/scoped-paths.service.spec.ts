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
 * Este spec cubre las tres cosas que tienen que cumplirse para que eso
 * no vuelva: que el scope se vea, que se restaure, y que anidarlo no
 * cuelgue el proceso.
 */
import { afterEach, describe, expect, test } from "vitest";
import { resolve } from "node:path";

import { outputDir, resetPathCache, withProjectRoot, withScopedPaths } from "../../projects/core/discovery/paths.service";

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

  /**
   * El acceso al singleton está serializado por una cola. Anidar dos
   * secciones encolaría la de dentro detrás de la de fuera, que no puede
   * terminar hasta que la de dentro lo haga: un bloqueo permanente, no
   * un test lento. Por eso hay un contador de profundidad.
   *
   * El timeout corto es deliberado: si la reentrancia se rompe, esto
   * falla en dos segundos en vez de colgar la suite entera.
   */
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

  test("dos secciones concurrentes no se pisan", async () => {
    const [a, b] = await Promise.all([
      withScopedPaths({ outputDir: "/tmp/a" }, async () => {
        await new Promise<void>((r) => setTimeout(r, 10));
        return outputDir();
      }),
      withScopedPaths({ outputDir: "/tmp/b" }, async () => outputDir()),
    ]);
    expect(a).toBe(resolve("/tmp/a"));
    expect(b).toBe(resolve("/tmp/b"));
  });
});
