import { afterEach, describe, expect, test } from "vitest";

import {
  outputBasename,
  outputDir,
  outputEnvironmentPath,
  resetPathCache,
} from "../../service/paths.service";

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

    test("sin projectName, usa el projectBasename del paquete", () => {
      expect(outputBasename()).toMatch(/(export-to-postman|postman-exporter)\.postman_collection/);
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
});
