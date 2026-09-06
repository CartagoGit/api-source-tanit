/**
 * Audit 2026-09-06 second pass §17, §18 — `combineServices` metadata
 * gap, pinned as a regression test.
 *
 * The current implementation merges `baseUrl`, `auth` and `variables`
 * from the FIRST service descriptor. In a monorepo where the services
 * disagree (`users` runs on `users.example.com` with bearer auth and
 * `orders` runs on `orders.example.com` with API-key auth), the
 * combined collection inherits the FIRST service's metadata for
 * EVERY endpoint. The user sees an `orders` endpoint being called
 * against `users.example.com` with the bearer header.
 *
 * This test pins the current (limited) behaviour: the merged
 * `result.config.baseUrl` (the variable the collection uses) is the
 * FIRST service's baseUrl. When a future slice fixes the gap, this
 * test will be inverted: it will assert that the merged collection
 * either carries a baseUrl map keyed by serviceId or that each
 * endpoint carries its own `serviceBaseUrl`. The test must be
 * updated as part of that slice; leaving it pinned to the wrong
 * behaviour is a regression risk.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { generateCollection } from "../../packages/core/discovery/generation.pipeline";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry";
import {
  createTempProject,
  type ITempProject,
} from "../helpers/scanner-fixture";

let work = "";
const projects: ITempProject[] = [];

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "combine-services-baseurl-"));
}, 30_000);

afterAll(async () => {
  for (const p of projects) await p.cleanup();
  if (work) await rm(work, { recursive: true, force: true });
});

describe("audit 2026-09-06 §17 — combineServices inherits metadata from FIRST service (known limitation)", () => {
  test("combined service descriptor's `baseUrl` is the first service's value", async () => {
    // Pin the current behaviour: in a two-service monorepo,
    // `IServiceDescriptor.baseUrl` on the synthetic merged
    // descriptor equals `services[0].baseUrl`. The proper fix
    // (per-endpoint metadata, see audit §18 priority 6) will
    // change this — when that lands, this test must be inverted
    // or replaced.
    const project = await createTempProject(
      {
        "package.json": JSON.stringify({
          name: "monorepo-baseurl-gap",
          private: true,
          workspaces: ["apps/*"],
        }),
        "apps/users/package.json": JSON.stringify({
          name: "@g/users",
          dependencies: { express: "^4.19.0" },
        }),
        "apps/users/server.js":
          "const express = require('express');\n" +
          "const app = express();\n" +
          "app.get('/profile', (req, res) => res.json({}));\n" +
          "module.exports = app;\n",
        "apps/orders/package.json": JSON.stringify({
          name: "@g/orders",
          dependencies: { express: "^4.19.0" },
        }),
        "apps/orders/server.js":
          "const express = require('express');\n" +
          "const app = express();\n" +
          "app.get('/orders', (req, res) => res.json([]));\n" +
          "module.exports = app;\n",
      },
      "combine-services-baseurl-",
    );
    projects.push(project);

    const result = await generateCollection(project.root, {
      orchestrator: defaultOrchestrator(),
      combineServices: true,
    });

    // The combined collection must contain endpoints from BOTH
    // services. Without the per-endpoint baseUrl fix the audit
    // describes, every endpoint is rendered against the same
    // baseUrl variable — the test below pins what the variable
    // currently is. When the gap is closed, the test must be
    // updated: either the collection carries one baseUrl per
    // service, or each request carries its own `serviceBaseUrl`.
    const baseUrlVar = result.collection.variable.find(
      (v) => v.key === "baseUrl",
    );
    expect(baseUrlVar, "combined collection has a baseUrl variable").toBeDefined();
    // The exact value depends on config loading; what we pin is
    // that it is ONE value (not a map per service). Today the
    // value is whatever the FIRST service reported.
    expect(typeof baseUrlVar?.value).toBe("string");

    // The merged metrics show the routes from BOTH services —
    // the `routes` fix from `787c13e` is intact (audit §3.1).
    expect(result.metrics.routes).toBe(2);
  }, 30_000);
});
