import { afterEach, describe, expect, test } from "vitest";

import { summarizeProject } from "../../services/summary.service";
import { defaultOrchestrator } from "../../frameworks/registry";
import { laravelLegacyDiscovery } from "../../frameworks/laravel/legacy-discovery";

const REPO_ROOT = `${process.cwd()}`;

describe("summary.service", () => {
  afterEach(() => {
    delete process.env["POSTMAN_PROJECT_ROOT"];
  });

  describe("summarizeProject", () => {
    test("lanza si projectRoot no existe", async () => {
      await expect(summarizeProject(
"/tmp/__no_existe_zzz__",
defaultOrchestrator(),
)).rejects.toThrow(
        /projectRoot no existe/,
      );
    });

    test("devuelve un resumen estructurado para un fixture Django conocido", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/django-mini`,
        defaultOrchestrator(),
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
        defaultOrchestrator(),
      );
      expect(summary.framework).toBe("express");
      expect(summary.routesInCode).toBeGreaterThan(0);
    });

    test("devuelve un resumen estructurado para un fixture FastAPI", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/fastapi-mini`,
        defaultOrchestrator(),
      );
      expect(summary.framework).toBe("fastapi");
      expect(summary.routesInCode).toBeGreaterThan(0);
    });

    test("devuelve un resumen estructurado para un fixture Symfony", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/symfony-mini`,
        defaultOrchestrator(),
      );
      expect(summary.framework).toBe("symfony");
      expect(summary.routesInCode).toBeGreaterThan(0);
    });

    // Laravel es el unico que sigue pasando por el camino legacy, asi
    // que es el unico caso que necesita el fallback inyectado. Sin el,
    // `routesInCode` es 0 — que es la respuesta correcta cuando no se
    // le ha dado ninguna estrategia de ultimo recurso.
    test("devuelve un resumen estructurado para un fixture Laravel", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/laravel-mini`,
        defaultOrchestrator(),
        laravelLegacyDiscovery,
      );
      expect(summary.framework).toBe("laravel");
      expect(summary.routesInCode).toBeGreaterThan(0);
    });

    test("expone counts de bodies/queries auto-inferidos", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/django-mini`,
        defaultOrchestrator(),
      );
      expect(typeof summary.bodiesAdded).toBe("number");
      expect(typeof summary.queriesAdded).toBe("number");
      expect(summary.bodiesAdded).toBeGreaterThanOrEqual(0);
      expect(summary.queriesAdded).toBeGreaterThanOrEqual(0);
    });

    test("ruta relativa se resuelve contra process.cwd", async () => {
      const summary = await summarizeProject(
"./tests/smoke-fixtures/django-mini",
defaultOrchestrator(),
);
      expect(summary.framework).toBe("django");
    });
  });
});
