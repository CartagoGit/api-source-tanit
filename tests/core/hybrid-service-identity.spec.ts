import { describe, expect, test } from "vitest";

import type { PostmanItem, PostmanRequest } from "../../packages/contracts/interfaces/core/postman.interface.js";
import { generateCollection } from "../../packages/core/discovery/generation.pipeline.js";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry.js";
import { createTempProject } from "../helpers/scanner-fixture.js";

const EXPRESS_MANIFEST = JSON.stringify({ name: "mock-api", dependencies: { express: "^4.19.0" } });
const EXPRESS_ROUTE = `
const express = require("express");
const app = express();
app.get("/same", (_req, res) => res.json({ ok: true }));
`;

function requests(items: readonly PostmanItem[]): PostmanRequest[] {
  return items.flatMap(item => item.request ? [item.request] : requests(item.item ?? []));
}

describe("service identity in HTTP generation", () => {
  test("fuses an Express route with OpenAPI from the same service and preserves both evidence sources", async () => {
    const project = await createTempProject({
      "package.json": EXPRESS_MANIFEST,
      "server.js": EXPRESS_ROUTE,
      "openapi.json": JSON.stringify({
        openapi: "3.0.3",
        info: { title: "Example API", version: "1" },
        paths: { "/same": { get: {
          description: "The documented operation",
          responses: { 200: { description: "OK" } },
        } } },
      }),
    });
    try {
      const result = await generateCollection(project.root, { orchestrator: defaultOrchestrator() });
      expect(result.specs).toHaveLength(1);
      expect(result.specs[0]).toMatchObject({
        method: "GET", uri: "/same", serviceId: result.serviceId, description: "The documented operation",
      });
      expect(requests(result.collection.item ?? []).map(request => [request.method, request.url.raw])).toEqual([
        ["GET", expect.stringMatching(/\/same$/)],
      ]);
      expect(result.contractEvidence?.operations).toMatchObject([{
        serviceId: result.serviceId,
        method: "GET", path: "/same", status: "matched",
        documented: [{ framework: "openapi", description: "The documented operation" }],
        observed: [{ framework: "express" }],
      }]);
    } finally {
      await project.cleanup();
    }
  });

  test("keeps the same HTTP route in different workspaces when exporting a combined collection", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["apps/*"] }),
      "apps/first/package.json": EXPRESS_MANIFEST,
      "apps/first/server.js": EXPRESS_ROUTE,
      "apps/second/package.json": JSON.stringify({ name: "second-api", dependencies: { express: "^4.19.0" } }),
      "apps/second/server.js": EXPRESS_ROUTE,
    });
    try {
      const result = await generateCollection(project.root, {
        orchestrator: defaultOrchestrator(),
        combineServices: true,
      });
      expect(result.specs).toHaveLength(2);
      expect(result.specs.every(spec => spec.method === "GET" && spec.uri === "/same")).toBe(true);
      expect(new Set(result.specs.map(spec => spec.serviceId)).size).toBe(2);
      expect(requests(result.collection.item ?? []).filter(request => request.url.raw.endsWith("/same"))).toHaveLength(2);
    } finally {
      await project.cleanup();
    }
  });
});
