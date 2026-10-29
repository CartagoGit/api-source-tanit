/**
 * The response-inference coverage reporter (proposal `r00020` S3).
 *
 * Two things are checked here:
 *
 * 1. **The arithmetic** — what the reporter says when a framework
 *    inferred some of its operations, all of them, or none.
 * 2. **The baseline** — the percentage each measured inferrer reaches
 *    on its reference fixture. The numbers are frozen in
 *    `RESPONSE_INFERENCE_COVERAGE_BASELINE`, and this spec measures
 *    them again: if an inferrer starts resolving fewer of its own
 *    fixture's routes, the test fails.
 *
 * ## Who is measured
 *
 * The **six** inferrers this slice delivers, plus the legacy NestJS
 * one — the only inferrer that predates the slice and still has a
 * reference fixture and a baseline (`nestjs: 100`). It is measured
 * through the product's own adapter
 * (`adaptLegacyResponseInferrer`), so what the spec pins is what the
 * dispatcher runs; the double that carries it across the section
 * boundary lives in `tests/helpers/response-inference-legacy.helper.ts`.
 *
 * The routes of each fixture are written down in
 * `tests/helpers/response-inference-routes.helper.ts`, and
 * `tests/frameworks/response-inference-routes.spec.ts` checks that
 * the scanners still report them.
 */
import { describe, expect, test, vi } from "vitest";

import {
  buildCoverageReport,
  logCoverageReport,
  reportResponseCoverage,
} from "../../packages/core/responses/coverage-reporter.js";
import {
  RESPONSE_INFERENCE_COVERAGE_BASELINE,
  RESPONSE_INFERENCE_REFERENCE_FIXTURES,
  RESPONSE_INFERRER_IDS,
} from "../../packages/contracts/constants/core/response-inference.constant.js";
import type { IResponseFrameworkCoverage } from "../../packages/contracts/interfaces/core/response-coverage.interface.js";
import type { IResponseInferrer } from "../../packages/contracts/interfaces/core/response-inferrer.interface.js";
import { ExpressResponseInferrer } from "../../packages/core/response-inference/express.helper.js";
import { FastifyResponseInferrer } from "../../packages/core/response-inference/fastify.helper.js";
import { GinResponseInferrer } from "../../packages/core/response-inference/gin.helper.js";
import { KtorRespondResponseInferrer } from "../../packages/core/response-inference/ktor-respond.helper.js";
import { LaravelResourcesResponseInferrer } from "../../packages/core/response-inference/laravel-resources.helper.js";
import { RailsRenderResponseInferrer } from "../../packages/core/response-inference/rails-render.helper.js";
import { REFERENCE_ROUTES } from "../helpers/response-inference-routes.helper.js";
import { nestjsResponseInferrer } from "../helpers/response-inference-legacy.helper.js";
import { contextOf, routeOf } from "./response-inference.helper.js";

/**
 * Every inferrer whose baseline is measured here, with the file it
 * reads.
 *
 * Six from this slice, plus the legacy NestJS one: a baseline nobody
 * measures is a baseline nobody can trust, and `nestjs: 100` was
 * declared and documented without a single test behind it.
 */
const MEASURED_INFERRERS: ReadonlyArray<{
  readonly id: (typeof RESPONSE_INFERRER_IDS)[number];
  readonly fixture: string;
  readonly source: string;
  readonly inferrer: IResponseInferrer;
}> = [
  {
    id: "express",
    fixture: "express-responses",
    source: "src/app.ts",
    inferrer: new ExpressResponseInferrer(),
  },
  {
    id: "fastify",
    fixture: "fastify-responses",
    source: "src/server.ts",
    inferrer: new FastifyResponseInferrer(),
  },
  {
    id: "gin",
    fixture: "gin-responses",
    source: "main.go",
    inferrer: new GinResponseInferrer(),
  },
  {
    id: "ktor-respond",
    fixture: "ktor-responses",
    source: "src/main.kt",
    inferrer: new KtorRespondResponseInferrer(),
  },
  {
    id: "laravel-resources",
    fixture: "laravel-resources",
    source: "routes/api.php",
    inferrer: new LaravelResourcesResponseInferrer(),
  },
  {
    id: "rails-render",
    fixture: "rails-render",
    source: "config/routes.rb",
    inferrer: new RailsRenderResponseInferrer(),
  },
  {
    id: "nestjs",
    fixture: "nestjs-response-inference",
    source: "src/users.controller.ts",
    inferrer: nestjsResponseInferrer,
  },
];

describe("coverage reporter — arithmetic (r00020 S3)", () => {
  test("a framework that inferred everything is at 100%", () => {
    const report = buildCoverageReport([
      { framework: "fastify", id: "fastify", total: 4, inferred: 4 },
    ]);
    const row = report.entries[0];
    expect(row?.percentage).toBe(100);
    expect(row?.belowBaseline).toBe(false);
    expect(report.percentage).toBe(100);
    expect(report.regressions).toHaveLength(0);
  });

  test("a framework that inferred half of its operations is at 50%", () => {
    const report = buildCoverageReport([
      { framework: "express", id: "express", total: 4, inferred: 2 },
    ]);
    expect(report.entries[0]?.percentage).toBe(50);
    expect(report.entries[0]?.belowBaseline).toBe(true);
    expect(report.regressions.map((r) => r.framework)).toEqual(["express"]);
  });

  test("a framework with no operations is at 0%, not NaN", () => {
    const report = buildCoverageReport([
      { framework: "cobol", id: null, total: 0, inferred: 0 },
    ]);
    expect(report.entries[0]?.percentage).toBe(0);
    expect(report.entries[0]?.baseline).toBeNull();
    expect(report.entries[0]?.belowBaseline).toBe(false);
  });

  test("the rows come out sorted by framework", () => {
    const report = buildCoverageReport([
      { framework: "express", id: "express", total: 1, inferred: 1 },
      { framework: "fastify", id: "fastify", total: 1, inferred: 0 },
      { framework: "gin", id: "gin", total: 1, inferred: 1 },
    ]);
    expect(report.entries.map((e) => e.framework)).toEqual([
      "express",
      "fastify",
      "gin",
    ]);
  });

  test("a project below the reference baseline is described, not accused", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const report = buildCoverageReport([
        { framework: "express", id: "express", total: 4, inferred: 1 },
      ]);
      logCoverageReport(report);
      const message = warn.mock.calls.map((call) => String(call[0])).join("\n");
      // The baseline belongs to the reference fixture, not to every
      // project the tool runs on: the message has to say that, and it
      // must not accuse the inferrer of something it did not do.
      expect(message).toContain("reference fixture");
      expect(message).not.toContain("regressed");
      expect(message).not.toContain("below baseline:");
    } finally {
      warn.mockRestore();
    }
  });

  test("the reporter says its numbers and never throws", () => {
    const report = reportResponseCoverage([
      { framework: "fastify", id: "fastify", total: 2, inferred: 2 },
    ]);
    expect(report.entries).toHaveLength(1);
    // Logging twice must not throw either — the reporter is called at
    // the end of the pipeline, and a diagnostic that throws would
    // break the generation it was only supposed to describe.
    expect(() => logCoverageReport(report)).not.toThrow();
    expect(() => logCoverageReport(buildCoverageReport([]))).not.toThrow();
  });
});

describe("coverage reporter — the frozen baseline (r00020 S3)", () => {
  test("every inferrer has a baseline and a reference fixture, or neither", () => {
    for (const id of RESPONSE_INFERRER_IDS) {
      const baseline = RESPONSE_INFERENCE_COVERAGE_BASELINE[id];
      const fixture = RESPONSE_INFERENCE_REFERENCE_FIXTURES[id];
      expect(
        baseline === null,
        `${id} has a baseline but no reference fixture (or the other way round)`,
      ).toBe(fixture === null);
    }
  });

  test.each(MEASURED_INFERRERS.map((c) => [c.id, c] as const))(
    "%s reaches its documented baseline on its reference fixture",
    (_id, entry) => {
      const routes = REFERENCE_ROUTES[entry.id] ?? [];
      expect(routes.length, `no reference routes for ${entry.id}`).toBeGreaterThan(0);

      const ctx = contextOf(entry.fixture, entry.inferrer.framework, entry.source);
      let inferred = 0;
      for (const reference of routes) {
        const spec = entry.inferrer.infer(
          routeOf({
            method: reference.method,
            uri: reference.uri,
            rawUri: reference.rawUri,
            sourceFile: reference.sourceFile,
            lineNumber: reference.lineNumber,
            controllerClass: reference.controllerClass,
            actionName: reference.actionName,
          }),
          ctx,
        );
        if (spec !== null) inferred++;
      }

      const percentage = Math.round((inferred / routes.length) * 1000) / 10;
      const baseline = RESPONSE_INFERENCE_COVERAGE_BASELINE[entry.id];
      expect(percentage, `measured coverage of ${entry.id}`).toBe(baseline);
    },
  );

  test("every inferrer with a baseline is measured here", () => {
    const measured = new Set(MEASURED_INFERRERS.map((entry) => entry.id));
    for (const id of RESPONSE_INFERRER_IDS) {
      if (RESPONSE_INFERENCE_COVERAGE_BASELINE[id] === null) continue;
      expect(
        measured.has(id),
        `${id} has a baseline but nobody measures it`,
      ).toBe(true);
    }
  });

  test("the measured counters describe the same frameworks the reporter knows", () => {
    const counters: ReadonlyArray<IResponseFrameworkCoverage> =
      MEASURED_INFERRERS.map((entry) => ({
        framework: entry.inferrer.framework,
        id: entry.id,
        total: (REFERENCE_ROUTES[entry.id] ?? []).length,
        inferred: (REFERENCE_ROUTES[entry.id] ?? []).length,
      }));
    const report = buildCoverageReport(counters);
    expect(report.entries).toHaveLength(MEASURED_INFERRERS.length);
    for (const row of report.entries) {
      expect(row.belowBaseline).toBe(false);
    }
  });
});
