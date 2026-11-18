/**
 * The case that justified `__params`, now without it.
 *
 * `OpenApiValidationProvider.supports()` had to say "this route is
 * mine" in a **hybrid** project —Express with an OpenAPI spec
 * alongside—, where `match.framework` is the dominant framework and
 * not the per-route one. Since `ParsedRoute` did not carry where it
 * came from, the scanner invented a hidden property, `__params`,
 * which it wrote and read with `as any` to keep the compiler from
 * seeing it.
 *
 * It was the fourth time the same missing piece bit us: route
 * identity. With `route.framework` the question answers itself and the
 * contract goes back to describing everything that flows through the
 * pipeline.
 */
import { describe, expect, test } from "vitest";

import { OpenApiProjectScanner, OpenApiRouteScanner, OpenApiValidationProvider } from "../../packages/frameworks/scanners/openapi.scanner";
import { smokeFixtureDir } from "../../scripts/helpers/root.helper";
import type {
  IProjectMatch,
  ParsedRoute,
} from "../../packages/contracts/interfaces/core/scanner.interface";
import { EMPTY_SCAN_RESULT } from "../helpers/empty-scan-result";

const provider = new OpenApiValidationProvider();

function ruta(framework?: string): ParsedRoute {
  return {
    ...(framework !== undefined ? { framework } : {}),
    method: "GET",
    uri: "/users",
    rawUri: "/users",
    sourceFile: "openapi.yaml#GET/users",
    lineNumber: 0,
    prefixChain: [],
  };
}

function proyecto(framework: string): IProjectMatch {
  return { framework, projectRoot: "/tmp/x", artifacts: [] };
}

describe("who owns each route in a hybrid project", () => {
  /**
   * THE case. The project is Express; the route comes from the
   * OpenAPI scanner. Without route identity it was impossible to tell,
   * and `__params` was the workaround.
   */
  test("an OpenAPI route in an Express project is claimed by OpenAPI", async () => {
    await expect(provider.supports(ruta("openapi"), proyecto("express"), EMPTY_SCAN_RESULT)).resolves.toBe(
      true,
    );
  });

  test("an Express route in an Express project is not claimed by OpenAPI", async () => {
    await expect(provider.supports(ruta("express"), proyecto("express"), EMPTY_SCAN_RESULT)).resolves.toBe(
      false,
    );
  });

  test("in a pure OpenAPI project it still says yes", async () => {
    await expect(provider.supports(ruta(), proyecto("openapi"), EMPTY_SCAN_RESULT)).resolves.toBe(true);
  });

  test("a route without framework in a foreign project is not claimed", async () => {
    await expect(provider.supports(ruta(), proyecto("express"), EMPTY_SCAN_RESULT)).resolves.toBe(false);
  });
});

describe("the scanner no longer leaks anything outside the contract", () => {
  test("the routes it emits only carry fields from the contract", async () => {
    const match = await new OpenApiProjectScanner().resolve(smokeFixtureDir("openapi"));
    const rutas = (await new OpenApiRouteScanner().scan(match)).routes;
    expect(rutas.length).toBeGreaterThan(0);

    // `__params` was the hidden property: if it returns, this catches it.
    for (const r of rutas) {
      expect(Object.keys(r)).not.toContain("__params");
    }
  });
});

describe("shared documentation evidence through real generation", () => {
  test("retains raw sources and identical summary/API reports for a flat hybrid service", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { generateCollection } = await import("../../packages/core/discovery/generation.pipeline.js");
    const { defaultOrchestrator } = await import("../../packages/frameworks/framework.registry.js");
    const { summarizeGenerationResults } = await import("../../packages/core/discovery/generation-summary.helper.js");
    const { summarizeSnapshot } = await import("../../packages/core/application-api/snapshot-summary.helper.js");
    const { makeSnapshot } = await import("../../packages/core/session/project-snapshot.js");
    const { SnapshotSummarySchema } = await import("../../packages/contracts/constants/core/application-api.constant.js");
    const root = await mkdtemp(join(tmpdir(), "tanit-doc-evidence-"));
    try {
      await writeFile(join(root, "package.json"), JSON.stringify({ name: "hybrid-evidence", dependencies: { express: "4" } }));
      await writeFile(join(root, "main.js"), "const express=require('express'); const app=express(); app.get('/users/:id', (req,res)=>res.json({ok:true})); app.get('/code-only', (req,res)=>res.json({ok:true}));");
      await writeFile(join(root, "openapi.json"), JSON.stringify({ openapi: "3.0.3", info: { title: "Evidence", version: "1" }, paths: { "/users/{id}": { get: { description: "Existing documentation", responses: { "200": { description: "OK" } } } }, "/doc-only": { get: { responses: { "200": { description: "OK" } } } } } }));
      const result = await generateCollection(root, { orchestrator: defaultOrchestrator() });
      const report = result.contractEvidence;
      expect(report).toBeDefined();
      expect(report?.sources.every(source => source.serviceId === result.serviceId)).toBe(true);
      expect(report?.operations.find(operation => operation.path === "/users/{id}")).toMatchObject({ status: "matched", documented: [{ file: "openapi.json#GET/users/{id}" }], observed: [{ file: expect.stringContaining("main.js") }] });
      expect(report?.operations.find(operation => operation.path === "/doc-only")?.status).toBe("unknown");
      expect(report?.operations.find(operation => operation.path === "/code-only")?.status).toBe("unknown");
      const summary = summarizeGenerationResults([result], result.frameworks);
      const snapshot = makeSnapshot({ sessionId: "evidence", projectRoot: root, results: [result], diagnostics: [] });
      const api = SnapshotSummarySchema.parse(summarizeSnapshot(snapshot));
      expect(summary.contractEvidence).toEqual([report]);
      expect(api.contractEvidence).toEqual(summary.contractEvidence);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
