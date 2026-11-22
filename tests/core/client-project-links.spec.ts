import { readdir, realpath, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

import type { IClientProjectLinksInput } from "../../packages/contracts/interfaces/core/client-consumption.interface.js";
import { analyzeClientProjectLinks } from "../../packages/core/discovery/client-usage.service.js";
import * as generation from "../../packages/core/discovery/generation.pipeline.js";
import { ProjectIndex } from "../../packages/core/index/project-index.service.js";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry.js";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture.js";

let fixture: ITempProject;
let root: string;
let backend: string;
let backendAlias: string;
let storefront: string;
let storefrontAlias: string;
let admin: string;

beforeAll(async () => {
  fixture = await createTempProject({
    "backend/package.json": JSON.stringify({ name: "api", private: true, workspaces: ["apps/*"] }),
    "backend/apps/catalog/package.json": JSON.stringify({ name: "catalog", dependencies: { "@nestjs/core": "^10.0.0" } }),
    "backend/apps/catalog/src/items.controller.ts": [
      'import { Controller, Get } from "@nestjs/common";',
      '@Controller("items")',
      'export class ItemsController { @Get() list() { return []; } }',
    ].join("\n"),
    "backend/apps/orders/package.json": JSON.stringify({ name: "orders", dependencies: { express: "^4.19.0" } }),
    "backend/apps/orders/server.js": [
      'const express = require("express");',
      "const app = express();",
      'app.get("/items", (_req, res) => res.json([]));',
      'app.get("/orders", (_req, res) => res.json([]));',
    ].join("\n"),
    "storefront/client.ts": 'fetch("/items");\nfetch("https://orders.example/items");',
    "storefront/app.component.html": "<div></div>",
    "admin/client.ts": 'http.get("/items");',
  }, "tanit-client-project-links-");
  root = await realpath(fixture.root);
  backend = join(root, "backend");
  backendAlias = join(root, "backend-alias");
  storefront = join(root, "storefront");
  storefrontAlias = join(root, "storefront-alias");
  admin = join(root, "admin");
  await symlink(backend, backendAlias, "junction");
  await symlink(storefront, storefrontAlias, "junction");
});

afterEach(() => vi.restoreAllMocks());
afterAll(async () => fixture?.cleanup());

function selection(): IClientProjectLinksInput {
  return {
    frontends: [{ root: admin, aliases: [{ receiver: "http" }] }, { root: storefrontAlias }],
    links: [
      { frontendRoot: storefront, backendRoot: backendAlias, serviceId: "apps_orders", host: "orders.example" },
      { frontendRoot: admin, backendRoot: backend, serviceId: "apps_catalog", host: "catalog.example" },
      { frontendRoot: storefrontAlias, backendRoot: backend, serviceId: "apps_catalog", host: "catalog.example" },
    ],
  };
}

it("scans each physical root once and compares only selected services in input order", async () => {
  const orchestrator = defaultOrchestrator();
  const generate = vi.spyOn(generation, "generateCollections");
  const open = vi.spyOn(ProjectIndex, "open");
  const close = vi.spyOn(ProjectIndex.prototype, "close");
  const before = (await readdir(root, { recursive: true })).sort();

  const report = await analyzeClientProjectLinks(selection(), orchestrator);
  const catalogId = JSON.stringify([backend, "apps_catalog"]);
  const ordersId = JSON.stringify([backend, "apps_orders"]);

  expect(generate.mock.calls).toEqual([[backend, { orchestrator, combineServices: false }]]);
  expect(open.mock.calls).toEqual([[admin], [storefront]]);
  expect(close).toHaveBeenCalledTimes(2);
  expect(report.frontends).toMatchObject([
    {
      root: admin,
      diagnostics: [],
      calls: [{
        status: "matched",
        backendId: catalogId,
        usage: { path: "/items", evidence: { recognizer: "configured-alias" } },
      }],
      backends: [{ id: catalogId, root: backend, serviceId: "apps_catalog", operationsWithoutConfirmedConsumer: [] }],
    },
    {
      root: storefront,
      diagnostics: [{ file: "app.component.html", reason: "unsupported-template" }],
      calls: [
        {
          status: "ambiguous",
          candidates: [{ backendId: ordersId, operation: { uri: "/items" } }, { backendId: catalogId, operation: { uri: "/items" } }],
        },
        { status: "matched", backendId: ordersId },
      ],
      backends: [
        { id: ordersId, root: backend, serviceId: "apps_orders", operationsWithoutConfirmedConsumer: [{ uri: "/orders" }] },
        { id: catalogId, root: backend, serviceId: "apps_catalog", operationsWithoutConfirmedConsumer: [{ uri: "/items" }] },
      ],
    },
  ]);
  expect((await readdir(root, { recursive: true })).sort()).toEqual(before);
});

it("keeps frontend-only observations and supports an empty selection", async () => {
  const orchestrator = defaultOrchestrator();
  const generate = vi.spyOn(generation, "generateCollections");
  await expect(analyzeClientProjectLinks({ frontends: [], links: [] }, orchestrator)).resolves.toEqual({ frontends: [] });
  const report = await analyzeClientProjectLinks({ frontends: [{ root: storefront }], links: [] }, orchestrator);
  expect(report.frontends).toMatchObject([{
    root: storefront,
    backends: [],
    calls: [{ status: "unknown", candidates: [] }, { status: "unknown", candidates: [] }],
  }]);
  expect(generate).not.toHaveBeenCalled();
});

it("rejects duplicate canonical frontends or links and links to undeclared frontends before discovery", async () => {
  const orchestrator = defaultOrchestrator();
  const generate = vi.spyOn(generation, "generateCollections");
  const open = vi.spyOn(ProjectIndex, "open");
  const link = { frontendRoot: storefront, backendRoot: backend, serviceId: "apps_catalog" };
  await expect(analyzeClientProjectLinks({
    frontends: [{ root: storefront }, { root: storefrontAlias }], links: [],
  }, orchestrator)).rejects.toThrow(/Duplicate frontend selection/u);
  await expect(analyzeClientProjectLinks({
    frontends: [{ root: storefront }],
    links: [link, { ...link, frontendRoot: storefrontAlias, backendRoot: backendAlias }],
  }, orchestrator)).rejects.toThrow(/Duplicate link/u);
  await expect(analyzeClientProjectLinks({
    frontends: [{ root: admin }], links: [link],
  }, orchestrator)).rejects.toThrow(/Link frontend is not selected/u);
  expect(open).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});

it("reports missing directories or service IDs without scanning a frontend", async () => {
  const orchestrator = defaultOrchestrator();
  const open = vi.spyOn(ProjectIndex, "open");
  const frontends = [{ root: storefront }];
  const link = { frontendRoot: storefront, backendRoot: backend, serviceId: "missing" };
  await expect(analyzeClientProjectLinks({
    frontends: [{ root: join(root, "missing") }], links: [],
  }, orchestrator)).rejects.toThrow(/Frontend directory unavailable/u);
  await expect(analyzeClientProjectLinks({
    frontends, links: [{ ...link, backendRoot: join(root, "missing") }],
  }, orchestrator)).rejects.toThrow(/Backend directory unavailable/u);
  await expect(analyzeClientProjectLinks({ frontends, links: [link] }, orchestrator))
    .rejects.toThrow(/Backend service "missing" unavailable.*Available service IDs:.*apps_catalog/u);
  expect(open).not.toHaveBeenCalled();
});
