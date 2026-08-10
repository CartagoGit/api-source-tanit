import { afterEach, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  describeDiscoveredPaths,
  outputBasename,
  outputDir,
  outputEnvironmentPath,
  packageRoot,
  resetPathCache,
} from "../../projects/core/discovery/paths.service";

describe("paths.service", () => {
  afterEach(() => {
    // Restaurar env / process.argv para que cada test sea aislado.
    delete process.env["POSTMAN_PROJECT_ROOT"];
    delete process.env["POSTMAN_OUTPUT_DIR"];
    delete process.env["POSTMAN_OUTPUT_BASENAME"];
    resetPathCache();
  });

  describe("outputBasename", () => {
    test("usa el projectName pasado como argumento", () => {
      const prev = process.env["POSTMAN_OUTPUT_BASENAME"];
      delete process.env["POSTMAN_OUTPUT_BASENAME"];
      expect(outputBasename("my-app")).toBe("my-app.postman_collection");
      if (prev !== undefined) process.env["POSTMAN_OUTPUT_BASENAME"] = prev;
    });

    test("respeta env POSTMAN_OUTPUT_BASENAME", () => {
      process.env["POSTMAN_OUTPUT_BASENAME"] = "custom";
      expect(outputBasename("my-app")).toBe("custom.postman_collection");
    });

    test("no duplica la extensión cuando env ya la trae", () => {
      process.env["POSTMAN_OUTPUT_BASENAME"] = "custom.postman_collection";
      expect(outputBasename("my-app")).toBe("custom.postman_collection");
    });

    /**
     * Se comprueba la **forma**, no el nombre de la carpeta.
     *
     * Antes exigía que el basename fuera `export-to-postman`, que es el
     * nombre del directorio donde está clonado el repo — y encima
     * duplicado en el OR, resto de un renombrado. Clonar en otra carpeta
     * hacía fallar el test; dentro de un contenedor, que monta en
     * `/work`, fallaba siempre.
     */
    test("sin projectName, deriva del basename del paquete", () => {
      const basename = outputBasename();
      expect(basename).toMatch(/^[\w.-]+\.postman_collection$/);
      expect(basename.startsWith(".")).toBe(false);
    });
  });

  describe("outputEnvironmentPath", () => {
    test("slugifica el nombre del environment", async () => {
      const path = await outputEnvironmentPath("Local");
      // Resultado esperado: <basename>.local.postman_environment.json
      expect(path).toMatch(/local\.postman_environment\.json$/);
    });

    test("elimina acentos y convierte a kebab-case", async () => {
      const path = await outputEnvironmentPath("Producción Local");
      expect(path).toMatch(/produccion-local\.postman_environment\.json$/);
    });

    test("elimina caracteres no alfanuméricos", async () => {
      const path = await outputEnvironmentPath("Stage_2 (QA)!");
      expect(path).toMatch(/stage-2-qa\.postman_environment\.json$/);
    });

    test("usa el projectName cuando se pasa explícitamente", async () => {
      const path = await outputEnvironmentPath("Dev", "my-app");
      expect(path).toMatch(/my-app\.dev\.postman_environment\.json$/);
    });
  });

  describe("outputDir CLI/env resolution", () => {
    test("respeta --output-dir", () => {
      const prev = process.argv;
      process.argv = [...prev, "--output-dir", "/tmp/abc/xyz"];
      expect(outputDir()).toBe("/tmp/abc/xyz");
      process.argv = prev;
    });

    test("respeta --output (con el parent)", () => {
      const prev = process.argv;
      process.argv = [...prev, "--output", "/tmp/some/file.json"];
      expect(outputDir()).toBe("/tmp/some");
      process.argv = prev;
    });

    test("respeta env POSTMAN_OUTPUT_DIR", () => {
      process.env["POSTMAN_OUTPUT_DIR"] = "/tmp/env-dir";
      expect(outputDir()).toBe("/tmp/env-dir");
    });

    test("CLI tiene prioridad sobre env", () => {
      const prev = process.argv;
      process.env["POSTMAN_OUTPUT_DIR"] = "/tmp/env-dir";
      process.argv = [...prev, "--output-dir", "/tmp/cli-dir"];
      expect(outputDir()).toBe("/tmp/cli-dir");
      process.argv = prev;
    });
  });

  /**
   * `packageRoot()` decía `projects/core`, y llevaba tiempo.
   *
   * El predicado que lo busca comprobaba una carpeta `contract`, en
   * singular, cuando se llama `contracts`: no casaba nunca, así que
   * siempre se caía al fallback «el padre de esta carpeta». Ese fallback
   * fue correcto cuando el fichero vivía un nivel bajo la raíz; al mover
   * el código a `projects/` dejó de serlo, y los dos fallos se taparon
   * mutuamente.
   *
   * Se pagó en dos sitios: en modo repo la salida iba a
   * `projects/core/export-to-postman/` —quedó una colección de
   * `example-app` ahí dentro—, y `POSTMAN_EXAMPLE` buscaba en
   * `projects/core/examples/`, que no existe, así que no hacía nada sin
   * decirlo.
   */
  /**
   * La traza que el CLI imprime antes de escanear existe para descartar
   * que se esté mirando la carpeta equivocada. Anunciaba una colección
   * que no era la que se escribía tres líneas más abajo: sin nombre de
   * proyecto, `outputBasename()` se cae al nombre del **directorio**, y
   * el fichero real se llama como diga el manifiesto.
   *
   * Sobre una copia de `example-express` en una carpeta `api/`, decía
   * `api.postman_collection.json` y escribía
   * `sample-express.postman_collection.json`.
   */
  describe("describeDiscoveredPaths — la traza no puede mentir", () => {
    test("sin nombre de proyecto, dice que aún no lo sabe", () => {
      process.env["POSTMAN_PROJECT_ROOT"] = "/tmp/una-carpeta-cualquiera";
      resetPathCache();
      const traza = describeDiscoveredPaths();
      expect(traza).toContain("<nombre-del-proyecto>");
      // Y no se inventa el nombre del directorio.
      expect(traza).not.toContain("una-carpeta-cualquiera.postman_collection");
    });

    test("con nombre, anuncia exactamente el fichero que se va a escribir", () => {
      process.env["POSTMAN_PROJECT_ROOT"] = "/tmp/una-carpeta-cualquiera";
      resetPathCache();
      expect(describeDiscoveredPaths("mi-api")).toContain(
        "mi-api.postman_collection.json",
      );
    });
  });

  describe("packageRoot — la raíz de este paquete, no la de una subcarpeta", () => {
    test("apunta a la raíz del repo, donde está el package.json", () => {
      const raiz = packageRoot();
      expect(existsSync(join(raiz, "package.json"))).toBe(true);
    });

    /** EL test: el marcador que el predicado busca tiene que existir. */
    test("contiene el marcador por el que se la reconoce", () => {
      const marcador = join(
        packageRoot(),
        "projects",
        "contracts",
        "constants",
        "core",
        "postman.constant.ts",
      );
      expect(existsSync(marcador), marcador).toBe(true);
    });

    test("no es una carpeta de dentro de projects/", () => {
      expect(packageRoot().endsWith(join("projects", "core"))).toBe(false);
    });

    /**
     * Escanear el propio repositorio tiene que escribir en su raíz, no
     * dentro del núcleo. Es el caso que el fallo rompía.
     */
    test("en modo repo la salida va a la raíz, no dentro de projects/", () => {
      const raiz = packageRoot();
      process.env["POSTMAN_PROJECT_ROOT"] = raiz;
      resetPathCache();
      expect(outputDir()).toBe(join(raiz, "export-to-postman"));
    });
  });
});
