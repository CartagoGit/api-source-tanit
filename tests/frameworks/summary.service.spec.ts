import { afterEach, describe, expect, test } from "vitest";

import { summarizeProject } from "../../packages/core/discovery/summary.service";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry";
import { laravelLegacyDiscovery } from "../../packages/frameworks/laravel/legacy-discovery";

const REPO_ROOT = `${process.cwd()}`;

describe("summary.service", () => {
  afterEach(() => {
    delete process.env["POSTMAN_PROJECT_ROOT"];
  });

  describe("summarizeProject", () => {
    test("throws when projectRoot does not exist", async () => {
      await expect(summarizeProject(
"/tmp/__no_existe_zzz__",
defaultOrchestrator(),
)).rejects.toThrow(
        /projectRoot does not exist/,
      );
    });

    test("returns a structured summary for a known Django fixture", async () => {
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

    test("returns a structured summary for an Express fixture", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/express-mini`,
        defaultOrchestrator(),
      );
      expect(summary.framework).toBe("express");
      expect(summary.routesInCode).toBeGreaterThan(0);
    });

    test("returns a structured summary for a FastAPI fixture", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/fastapi-mini`,
        defaultOrchestrator(),
      );
      expect(summary.framework).toBe("fastapi");
      expect(summary.routesInCode).toBeGreaterThan(0);
    });

    test("returns a structured summary for a Symfony fixture", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/symfony-mini`,
        defaultOrchestrator(),
      );
      expect(summary.framework).toBe("symfony");
      expect(summary.routesInCode).toBeGreaterThan(0);
    });

    // Laravel is the only one still going through the legacy path, so
    // it is the only case that needs the injected fallback. Without it,
    // `routesInCode` is 0 — which is the correct answer when no
    // last-resort strategy has been provided.
    test("returns a structured summary for a Laravel fixture", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/laravel-mini`,
        defaultOrchestrator(),
        laravelLegacyDiscovery,
      );
      expect(summary.framework).toBe("laravel");
      expect(summary.routesInCode).toBeGreaterThan(0);
    });

    test("exposes counts of auto-inferred bodies/queries", async () => {
      const summary = await summarizeProject(
        `${REPO_ROOT}/tests/smoke-fixtures/django-mini`,
        defaultOrchestrator(),
      );
      expect(typeof summary.bodiesAdded).toBe("number");
      expect(typeof summary.queriesAdded).toBe("number");
      expect(summary.bodiesAdded).toBeGreaterThanOrEqual(0);
      expect(summary.queriesAdded).toBeGreaterThanOrEqual(0);
    });

    test("relative path is resolved against process.cwd", async () => {
      const summary = await summarizeProject(
"./tests/smoke-fixtures/django-mini",
defaultOrchestrator(),
);
      expect(summary.framework).toBe("django");
    });
  });
});
