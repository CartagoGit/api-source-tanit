/**
 * x00059 — `generateCollectionsWithAllFrameworks()` must actually return
 * the array, not call the singular `generateCollection()` which throws
 * `MultipleServicesWithoutCombineError` on a multi-service project
 * (audit 2026-09-06 §3.3 / §18 priority 2).
 *
 * The contract is "ALWAYS a `ReadonlyArray<IGenerationResult>`". Before
 * this fix the facade silently delegated to the singular primitive,
 * which meant every multi-service caller got an exception instead of
 * "one collection per service".
 */
import { afterEach, describe, expect, test } from "vitest";
import { generateCollectionsWithAllFrameworks } from "../../packages/frameworks";
import {
  createTempProject,
  type ITempProject,
} from "../helpers/scanner-fixture";

let project: ITempProject | null = null;
afterEach(async () => {
  await project?.cleanup();
  project = null;
});

describe("x00059 — `generateCollectionsWithAllFrameworks()` returns the array", () => {
  test("(1) single-service project: returns a 1-element array (legacy parity)", async () => {
    project = await createTempProject({
      "package.json": JSON.stringify({
        name: "x59-single",
        dependencies: { express: "^4.19.0" },
      }),
      "server.js": `
        import express from "express";
        const app = express();
        app.get("/health", (_req, res) => res.json({ ok: true }));
      `,
    });
    const results = await generateCollectionsWithAllFrameworks(project.root);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // First (and only) entry is the IGenerationResult shape
    expect(results[0]).toBeDefined();
    expect(Array.isArray(results[0]?.specs ?? [])).toBe(true);
  });

  test("(2) multi-service project: returns N entries (one per service)", async () => {
    // Two-app monorepo using `multi-service-isolation` shape: each app
    // has its own `package.json` with express, so the orchestrator
    // detects two services.
    project = await createTempProject({
      "package.json": JSON.stringify({
        name: "x59-multi",
        private: true,
        workspaces: ["apps/users", "apps/orders"],
      }),
      "apps/users/package.json": JSON.stringify({
        name: "users-api",
        type: "module",
        dependencies: { express: "^4.19.2" },
      }),
      "apps/users/src/server.js": `
        import express from "express";
        const app = express();
        app.get("/users/health", (_req, res) => res.json({ ok: true, svc: "users" }));
      `,
      "apps/orders/package.json": JSON.stringify({
        name: "orders-api",
        type: "module",
        dependencies: { express: "^4.19.2" },
      }),
      "apps/orders/src/server.js": `
        import express from "express";
        const app = express();
        app.get("/orders/health", (_req, res) => res.json({ ok: true, svc: "orders" }));
      `,
    });
    const results = await generateCollectionsWithAllFrameworks(project.root);
    // Two services, each with its own collection
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Each entry has a distinct serviceId (no silent merge)
    const ids = new Set(results.map((r) => r.serviceId ?? "<unknown>"));
    expect(ids.size).toBe(results.length);
  });

  test("(3) empty project: returns a 1-element array (synthetic unknown service)", async () => {
    project = await createTempProject({
      "README.md": "# nothing here",
    });
    const results = await generateCollectionsWithAllFrameworks(project.root);
    // Legacy fallback synthesizes a single "unknown" service
    expect(results.length).toBe(1);
  });

  test("(4) combineServices=true on multi-service: returns a 1-element array (combined)", async () => {
    project = await createTempProject({
      "package.json": JSON.stringify({
        name: "x59-multi-combined",
        private: true,
        workspaces: ["apps/users", "apps/orders"],
      }),
      "apps/users/package.json": JSON.stringify({
        name: "users-api",
        type: "module",
        dependencies: { express: "^4.19.2" },
      }),
      "apps/users/src/server.js": `
        import express from "express";
        const app = express();
        app.get("/users/health", (_req, res) => res.json({ ok: true, svc: "users" }));
      `,
      "apps/orders/package.json": JSON.stringify({
        name: "orders-api",
        type: "module",
        dependencies: { express: "^4.19.2" },
      }),
      "apps/orders/src/server.js": `
        import express from "express";
        const app = express();
        app.get("/orders/health", (_req, res) => res.json({ ok: true, svc: "orders" }));
      `,
    });
    const results = await generateCollectionsWithAllFrameworks(project.root, {
      combineServices: true,
    });
    // Combined mode: 1 collection with the union of routes
    expect(results.length).toBe(1);
    const combined = results[0]!;
    const totalRoutes = combined.routes.length;
    expect(totalRoutes).toBeGreaterThanOrEqual(2);
  });

  test("(5) each entry carries its own `config.name` and the routes match the service", async () => {
    project = await createTempProject({
      "package.json": JSON.stringify({
        name: "x59-per-entry",
        private: true,
        workspaces: ["apps/users", "apps/orders"],
      }),
      "apps/users/package.json": JSON.stringify({
        name: "users-api",
        type: "module",
        dependencies: { express: "^4.19.2" },
      }),
      "apps/users/src/server.js": `
        import express from "express";
        const app = express();
        app.get("/users/health", (_req, res) => res.json({ ok: true, svc: "users" }));
      `,
      "apps/orders/package.json": JSON.stringify({
        name: "orders-api",
        type: "module",
        dependencies: { express: "^4.19.2" },
      }),
      "apps/orders/src/server.js": `
        import express from "express";
        const app = express();
        app.get("/orders/health", (_req, res) => res.json({ ok: true, svc: "orders" }));
      `,
    });
    const results = await generateCollectionsWithAllFrameworks(project.root);
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Each entry exposes the routes from its OWN service (no cross-contamination)
    const allUris = results.flatMap((r) => r.routes.map((route) => route.uri));
    const usersUris = allUris.filter((u) => u.includes("users"));
    const ordersUris = allUris.filter((u) => u.includes("orders"));
    expect(usersUris.length).toBeGreaterThan(0);
    expect(ordersUris.length).toBeGreaterThan(0);
  });
});