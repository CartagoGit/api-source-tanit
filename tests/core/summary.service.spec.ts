import { afterEach, describe, expect, test } from "vitest";

import { summarizeProject } from "../../service/summary.service";

const REPO_ROOT = `${process.cwd()}`;

describe("summary.service", () => {
  afterEach(() => {
    delete process.env["POSTMAN_PROJECT_ROOT"];
  });

  describe("summarizeProject", () => {
    test("lanza si projectRoot no existe", async () => {
      await expect(summarizeProject("/tmp/__no_existe_zzz__")).rejects.toThrow(
        /projectRoot no existe/,
      );
    });

    test("devuelve un resumen estructurado para un fixture Django conocido", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/django-mini`,
      );
      expect(summary.framework).toBe("django");
      expect(summary.projectName).toBe("django-mini");
      expect(summary.routesInCode).toBe(4);
      expect(summary.zeroConfig).toBe(true);
      expect(summary.configPath).toBe("<zero-config>");
    });

    test("devuelve un resumen estructurado para un fixture Express", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/express-mini`,
      );
      expect(summary.framework).toBe("express");
      expect(summary.routesInCode).toBeGreaterThan(0);
    });

    test("devuelve un resumen estructurado para un fixture FastAPI", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/fastapi-mini`,
      );
      expect(summary.framework).toBe("fastapi");
      expect(summary.routesInCode).toBeGreaterThan(0);
    });

    test("devuelve un resumen estructurado para un fixture Symfony", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/symfony-mini`,
      );
      expect(summary.framework).toBe("symfony");
      expect(summary.routesInCode).toBeGreaterThan(0);
    });

    test("devuelve un resumen estructurado para un fixture Laravel", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/laravel-mini`,
      );
      expect(summary.framework).toBe("laravel");
      expect(summary.routesInCode).toBeGreaterThan(0);
    });

    test("expone counts de bodies/queries auto-inferidos", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/django-mini`,
      );
      expect(typeof summary.bodiesAdded).toBe("number");
      expect(typeof summary.queriesAdded).toBe("number");
      expect(summary.bodiesAdded).toBeGreaterThanOrEqual(0);
      expect(summary.queriesAdded).toBeGreaterThanOrEqual(0);
    });

    test("ruta relativa se resuelve contra process.cwd", async () => {
      const summary = await summarizeProject(
        "./tests/smoke-fixtures/django-mini",
      );
      expect(summary.framework).toBe("django");
    });
  });
});
