/**
 * Per-service metrics — audit 2026-09-06, section 3.1.
 *
 * Before this slice, `IGenerationResult.metrics` came from the global
 * catalog (`discovery.routes`, `discovery.withValidation`,
 * `discovery.withoutValidation`). In a monorepo with N services,
 * every service's `IGenerationResult` reported the SAME total route
 * count: the union of every service's endpoints.
 *
 * Downstream consumers (UI, stats, MCP, integrations, the summary
 * view, future dashboards) read `metrics.routes` as "how many
 * endpoints does this service expose". With the leak, that number
 * was always the global total regardless of service. The audit
 * classified this as **P1 contractual**.
 *
 * The fix recomputes `routes`, `withValidation` and
 * `withoutValidation` against the per-service filtered list
 * (`service.endpoints` and `specs` respectively). The contract
 * pinned by these tests:
 *
 *   1. Multi-service with `combineServices: false` → one
 *      `IGenerationResult` per service; each reports ONLY its own
 *      endpoint count.
 *   2. Multi-service with `combineServices: true` → ONE combined
 *      `IGenerationResult`; the metric is the sum (the combined
 *      descriptor's `endpoints` is the union).
 *   3. Single-service: metric equals the project's route count
 *      (legacy path unchanged).
 *
 * Synthetic fixtures are used with `createTempProject` so we do not
 * depend on the real monorepo fixture under `tests/fixtures/`.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { generateCollection } from "../../packages/core/discovery/generation.pipeline";
import { generateCollections } from "../../packages/core/discovery/generation.pipeline";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry";
import {
  createTempProject,
  type ITempProject,
} from "../helpers/scanner-fixture";

let work = "";
const projects: ITempProject[] = [];

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "metrics-per-service-"));
}, 30_000);

afterAll(async () => {
  for (const p of projects) await p.cleanup();
  if (work) await rm(work, { recursive: true, force: true });
});

/** Express fixture body — minimal, enough to produce two GETs. */
function expressServer(gets: ReadonlyArray<string>): string {
  const lines = gets.map(
    (path) => `app.get(${JSON.stringify(path)}, (_req, res) => res.json([]));`,
  );
  return `const express = require("express");\nconst app = express();\n${lines.join("\n")}\nmodule.exports = app;\n`;
}

async function buildMonorepoWith(
  apps: ReadonlyArray<{
    readonly id: string;
    readonly packageName: string;
    readonly paths: ReadonlyArray<string>;
  }>,
): Promise<ITempProject> {
  const tree: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "monorepo-metrics",
      private: true,
      workspaces: ["apps/*"],
    }),
  };
  for (const app of apps) {
    tree[`apps/${app.id}/package.json`] = JSON.stringify({
      name: app.packageName,
      dependencies: { express: "^4.19.0" },
    });
    tree[`apps/${app.id}/server.js`] = expressServer(app.paths);
  }
  return createTempProject(tree, "metrics-per-service-");
}

describe("audit 2026-09-06 §3.1 — metrics are per-service, not global", () => {
  test("multi-service (combineServices=false): each result.metrics.routes equals ONLY its own endpoints", async () => {
    // 2 services, 2 endpoints each → each service must report 2, not 4.
    const project = await buildMonorepoWith([
      {
        id: "users",
        packageName: "@m/users",
        paths: ["/users", "/users/:id"],
      },
      {
        id: "orders",
        packageName: "@m/orders",
        paths: ["/orders", "/orders/:id"],
      },
    ]);
    projects.push(project);

    const results = await generateCollections(project.root, {
      orchestrator: defaultOrchestrator(),
      combineServices: false,
    });

    expect(results).toHaveLength(2);

    // Order is not guaranteed — key by serviceId.
    const byService = new Map(results.map((r) => [r.serviceId, r]));
    const users = byService.get("apps_users");
    const orders = byService.get("apps_orders");
    expect(users, "apps_users result missing").toBeDefined();
    expect(orders, "apps_orders result missing").toBeDefined();

    // Each result reports ONLY its own endpoints: 2, not 4.
    expect(users!.metrics.routes).toBe(2);
    expect(orders!.metrics.routes).toBe(2);

    // The exact withValidation / withoutValidation split depends on
    // the scanner (Express attaches path params as fields, so
    // `/users/:id` counts as validated). What matters is the
    // per-service invariant: the two counts sum to the spec count
    // for THIS service, not the global union.
    expect(users!.metrics.withValidation + users!.metrics.withoutValidation).toBe(
      users!.metrics.specs,
    );
    expect(orders!.metrics.withValidation + orders!.metrics.withoutValidation).toBe(
      orders!.metrics.specs,
    );

    // specs matches the per-service count too.
    expect(users!.metrics.specs).toBe(2);
    expect(orders!.metrics.specs).toBe(2);
  }, 30_000);

  test("multi-service (combineServices=true): combined result.metrics.routes equals the union", async () => {
    const project = await buildMonorepoWith([
      { id: "users", packageName: "@m/users", paths: ["/users", "/users/:id"] },
      { id: "orders", packageName: "@m/orders", paths: ["/orders", "/orders/:id"] },
    ]);
    projects.push(project);

    const result = await generateCollection(project.root, {
      orchestrator: defaultOrchestrator(),
      combineServices: true,
    });

    // The combined descriptor merges every service's endpoints. The
    // audit's complaint was about per-service reporting the GLOBAL
    // count — the combined case legitimately reports the union,
    // because there is only one collection.
    expect(result.metrics.routes).toBe(4);
    expect(result.metrics.specs).toBe(4);
  }, 30_000);

  test("single-service (legacy): metrics.routes equals the project's route count", async () => {
    const project = await buildMonorepoWith([
      { id: "api", packageName: "@m/api", paths: ["/a", "/b", "/c"] },
    ]);
    projects.push(project);

    const result = await generateCollection(project.root, {
      orchestrator: defaultOrchestrator(),
    });

    expect(result.metrics.routes).toBe(3);
    expect(result.metrics.specs).toBe(3);
  }, 30_000);
});
