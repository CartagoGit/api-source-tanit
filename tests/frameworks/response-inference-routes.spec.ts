/**
 * The reference routes of the response-inference fixtures (proposal
 * `r00020` S3).
 *
 * The coverage baseline of every inferrer is measured over a **fixed**
 * list of routes — the ones written down in
 * `tests/helpers/response-inference-routes.helper.ts`. This spec is
 * what keeps that list true: it runs each scanner over its fixture
 * and compares what the scanner reports with what was written down.
 *
 * When a scanner changes — a route added, a prefix renamed — this
 * spec fails, and the baseline has to be measured again. That is the
 * point: a baseline nobody re-measures is a baseline nobody can
 * trust.
 */
import { describe, expect, test } from "vitest";
import { join } from "node:path";

import { ExpressProjectScanner, ExpressRouteScanner } from "../../packages/frameworks/scanners/express.scanner.js";
import { FastifyProjectScanner, FastifyRouteScanner } from "../../packages/frameworks/scanners/fastify.scanner.js";
import { GinProjectScanner, GinRouteScanner } from "../../packages/frameworks/scanners/gin.scanner.js";
import { KtorProjectScanner, KtorRouteScanner } from "../../packages/frameworks/scanners/ktor.scanner.js";
import { RailsProjectScanner, RailsRouteScanner } from "../../packages/frameworks/scanners/rails.scanner.js";
import { LaravelProjectScanner, LaravelRouteScanner } from "../../packages/frameworks/laravel/laravel.scanner.js";
import { NestJsProjectScanner, NestJsRouteScanner } from "../../packages/frameworks/scanners/nestjs.scanner.js";
import type { ResponseInferrerId } from "../../packages/contracts/constants/core/response-inference.constant.js";
import { REFERENCE_ROUTES } from "../helpers/response-inference-routes.helper.js";
import { FIXTURES_DIR } from "../../scripts/helpers/root.helper.js";

/** The scanner of every fixture the coverage measures over. */
const SCANNERS: ReadonlyArray<{
  readonly id: ResponseInferrerId;
  readonly fixture: string;
  readonly Project: new () => { resolve(root: string): Promise<{ projectRoot: string }> };
  readonly Route: new () => { scan(match: { projectRoot: string }): Promise<{ routes: ReadonlyArray<{ method: string; uri: string; rawUri: string; sourceFile: string; lineNumber: number }> }> };
}> = [
  { id: "express", fixture: "express-responses", Project: ExpressProjectScanner, Route: ExpressRouteScanner },
  { id: "fastify", fixture: "fastify-responses", Project: FastifyProjectScanner, Route: FastifyRouteScanner },
  { id: "gin", fixture: "gin-responses", Project: GinProjectScanner, Route: GinRouteScanner },
  { id: "ktor-respond", fixture: "ktor-responses", Project: KtorProjectScanner, Route: KtorRouteScanner },
  { id: "rails-render", fixture: "rails-render", Project: RailsProjectScanner, Route: RailsRouteScanner },
  { id: "laravel-resources", fixture: "laravel-resources", Project: LaravelProjectScanner, Route: LaravelRouteScanner },
  { id: "nestjs", fixture: "nestjs-response-inference", Project: NestJsProjectScanner, Route: NestJsRouteScanner },
];

describe("reference routes of the response-inference fixtures (r00020 S3)", () => {
  test.each(SCANNERS.map((s) => [s.id, s] as const))(
    "the %s scanner reports the routes the baseline was measured on",
    async (_id, entry) => {
      const root = join(FIXTURES_DIR, entry.fixture);
      const match = await new entry.Project().resolve(root);
      const scan = await new entry.Route().scan(match);
      const expected = REFERENCE_ROUTES[entry.id] ?? [];

      const reported = scan.routes.map((r) => ({
        method: r.method,
        uri: r.uri,
        rawUri: r.rawUri,
        sourceFile: r.sourceFile,
        lineNumber: r.lineNumber,
      }));
      const wanted = expected.map((r) => ({
        method: r.method,
        uri: r.uri,
        rawUri: r.rawUri,
        sourceFile: r.sourceFile,
        lineNumber: r.lineNumber,
      }));

      expect(reported).toEqual(wanted);
    },
  );
});
