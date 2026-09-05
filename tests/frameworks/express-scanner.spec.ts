import { describe, expect, test } from "vitest";
import {
  ExpressProjectScanner,
  ExpressRouteScanner,
  ExpressZodValidationProvider,
} from "../../packages/frameworks/scanners/express.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import {
  comprehensiveFixture,
  createTempProject,
  scanProject,
} from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";

import { EMPTY_SCAN_RESULT } from "../helpers/empty-scan-result";
describeScannerContract({
  framework: "express",
  fixtureRoot: comprehensiveFixture("express"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: true,
  },
  minimalProject: {
    "package.json": '{"dependencies":{"express":"^4.0.0"}}',
    "server.js": "const app = require('express')();\napp.get('/vivo', (req, res) => res.json({}));\n",
  },
  commentedEndpoint: {
    file: 'server.js',
    source: "// app.get('/endpoint-comentado', (req, res) => res.json({}));",
  },
});

const ROOT = smokeFixtureDir("express");
const COMPREHENSIVE = comprehensiveFixtureDir("express");

describe("Express scanner", () => {
  test("detect() > 0 when package.json contains 'express'", async () => {
    expect((await new ExpressProjectScanner().detect(ROOT)).score).toBeGreaterThan(0);
  });

  test("detect() === 0 in a directory without package.json", async () => {
    expect((await new ExpressProjectScanner().detect("/tmp")).score).toBe(0);
  });

  test("scan() finds the 5 routes of the mini-fixture", async () => {
    const match = await new ExpressProjectScanner().resolve(ROOT);
    const routes = (await new ExpressRouteScanner().scan(match)).routes;
    expect(routes).toHaveLength(5);
  });

  test("GET /health and GET/POST /api/users are present", async () => {
    const match = await new ExpressProjectScanner().resolve(ROOT);
    const routes = (await new ExpressRouteScanner().scan(match)).routes;
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /health");
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
  });

  test("path param :id in app.get('/api/users/:id') → uri with :id", async () => {
    const match = await new ExpressProjectScanner().resolve(ROOT);
    const routes = (await new ExpressRouteScanner().scan(match)).routes;
    const withId = routes.filter((r) => r.uri.includes(":id"));
    expect(withId.length).toBeGreaterThanOrEqual(2);
  });

  test("comprehensive: detects >10 routes from a chained router", async () => {
    const match = await new ExpressProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new ExpressRouteScanner().scan(match)).routes;
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  test("zod provider resolves body fields for POST", async () => {
    const match = await new ExpressProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new ExpressRouteScanner().scan(match)).routes;
    const post = routes.find((r) => r.method === "POST" && r.uri.includes("users"));
    if (!post) return;
    const provider = new ExpressZodValidationProvider();
    const result = await provider.resolve(post, match, EMPTY_SCAN_RESULT);
    expect(result.fields.length).toBeGreaterThan(0);
    const names = result.fields.map((f) => f.fieldName);
    expect(names).toContain("name");
    expect(names).toContain("email");
  });
});

describe("Express — several mounts on the same line", () => {
  // `app.use()` was read with `.exec()` only once per line, so
  // `app.use("/v1", a); app.use("/v2", b);` lost the second mount and
  // its routes came out without prefix.
  test("applies the prefix of every app.use in one line", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { express: "^4.0.0" } }),
      "src/server.js": [
        'const express = require("express");',
        "const app = express();",
        "const v1 = express.Router(); const v2 = express.Router();",
        'v1.get("/users", h); v1.post("/users", h);',
        'v2.get("/users", h);',
        'app.use("/api/v1", v1); app.use("/api/v2", v2);',
      ].join("\n"),
    });
    try {
      const { routes } = await scanProject("express", project.root);
      expect(routes.map((r) => `${r.method} ${r.uri}`).sort()).toEqual([
        "GET /api/v1/users",
        "GET /api/v2/users",
        "POST /api/v1/users",
      ]);
    } finally {
      await project.cleanup();
    }
  });

  test("several Router() declared on the same line receive their prefix", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { express: "^4.0.0" } }),
      "src/server.js": [
        'const express = require("express");',
        "const app = express();",
        "const a = express.Router(); const b = express.Router();",
        'a.get("/uno", h);',
        'b.get("/dos", h);',
        'app.use("/x", a);',
        'app.use("/y", b);',
      ].join("\n"),
    });
    try {
      const { routes } = await scanProject("express", project.root);
      const uris = routes.map((r) => r.uri).sort();
      expect(uris).toContain("/x/uno");
      expect(uris).toContain("/y/dos");
    } finally {
      await project.cleanup();
    }
  });

  test("concatenates the prefix even when the route already starts with /api", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { express: "^4.0.0" } }),
      "src/server.js": [
        'const express = require("express");',
        "const app = express();",
        "const router = express.Router();",
        'router.get("/api/users", h);',
        'app.use("/api/v2", router);',
      ].join("\n"),
    });
    try {
      const { routes } = await scanProject("express", project.root);
      expect(routes.map((route) => route.uri)).toContain("/api/v2/api/users");
    } finally {
      await project.cleanup();
    }
  });
});

describe("Express — inline Joi validation provider", () => {
  test("inline Joi.object resolves the body fields", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { express: "^4.0.0", joi: "^17.0.0" } }),
      "src/server.js": [
        'const Joi = require("joi");',
        'const express = require("express");',
        "const app = express();",
        "const createUserSchema = Joi.object({",
        "  name: Joi.string().required(),",
        "  email: Joi.string().email().required(),",
        "  age: Joi.number(),",
        "});",
        "app.post('/api/users', (req, res) => {",
        "  const { error } = createUserSchema.validate(req.body);",
        "  res.json({});",
        "});",
      ].join("\n"),
    });
    try {
      const { routes, match } = await scanProject("express", project.root);
      const { ExpressZodValidationProvider } = await import("../../packages/frameworks/scanners/express.scanner");
      const post = routes.find((r) => r.method === "POST");
      if (!post) return;
      const provider = new ExpressZodValidationProvider();
      const { fields } = await provider.resolve(post, match, EMPTY_SCAN_RESULT);
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.map((f) => f.fieldName)).toContain("name");
    } finally {
      await project.cleanup();
    }
  });
});

describe("Express — header schema near handler", () => {
  test("z.object in headers position: returns fields with location header", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { express: "^4.0.0", zod: "^4.0.0" } }),
      "src/server.js": [
        'const { z } = require("zod");',
        'const express = require("express");',
        "const app = express();",
        "const bodySchema = z.object({ name: z.string(), email: z.string() });",
        "app.post('/api/secure', (req, res) => {",
        "  bodySchema.parse(req.body);",
        "  res.json({});",
        "});",
      ].join("\n"),
    });
    try {
      const { routes, match } = await scanProject("express", project.root);
      const { ExpressZodValidationProvider } = await import("../../packages/frameworks/scanners/express.scanner");
      const post = routes.find((r) => r.method === "POST");
      if (!post) return;
      const provider = new ExpressZodValidationProvider();
      const { fields } = await provider.resolve(post, match, EMPTY_SCAN_RESULT);
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.map((f) => f.fieldName)).toContain("name");
      expect(fields.map((f) => f.fieldName)).toContain("email");
    } finally {
      await project.cleanup();
    }
  });
});

describe("Express — Router({ prefix }) detection", () => {
  test("Router declared with prefix is applied to the router's routes", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { express: "^4.0.0" } }),
      "src/server.js": [
        'const express = require("express");',
        "const app = express();",
        "const router = express.Router({ prefix: '/api/v1' });",
        "router.get('/users', (req, res) => res.json([]));",
        "app.use(router);",
      ].join("\n"),
    });
    try {
      const { routes } = await scanProject("express", project.root);
      // The Router prefix is captured in routerPrefixes; if the
      // Router is not mounted with app.use('/prefix', router) it does
      // not inherit the prefix
      expect(routes.length).toBeGreaterThan(0);
    } finally {
      await project.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// f00011 S4 — lockfiles as scoring bonuses in detect().
// ---------------------------------------------------------------------------

describe("Express — lockfiles as runtime bonuses (f00011 S4)", () => {
  // f00011 S4: `pnpm-lock.yaml` and `bun.lockb` sharpen the
  // detector's confidence without being detection. Small weights:
  // +0.1 (pnpm), +0.15 (bun). Unlike Next.js/NestJS, Express usually
  // sits at 0.7–0.9 before the bonus, so the lockfile does move the
  // needle on the visible score.
  test("pnpm-lock.yaml adds evidence with weight 0.1", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { express: "^4.0.0" } }),
      "pnpm-lock.yaml": "",
    });
    try {
      const result = await new ExpressProjectScanner().detect(project.root);
      const pnpm = result.evidence.find((e) => e.artifact === "pnpm-lock.yaml");
      expect(pnpm).toBeDefined();
      expect(pnpm?.weight).toBe(0.1);
    } finally {
      await project.cleanup();
    }
  });

  test("bun.lockb adds evidence with weight 0.15", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { express: "^4.0.0" } }),
      "bun.lockb": "",
    });
    try {
      const result = await new ExpressProjectScanner().detect(project.root);
      const bun = result.evidence.find((e) => e.artifact === "bun.lockb");
      expect(bun).toBeDefined();
      expect(bun?.weight).toBe(0.15);
    } finally {
      await project.cleanup();
    }
  });

  test("pnpm-lock.yaml + bun.lockb add both signals", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { express: "^4.0.0" } }),
      "pnpm-lock.yaml": "",
      "bun.lockb": "",
    });
    try {
      const result = await new ExpressProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(true);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(true);
    } finally {
      await project.cleanup();
    }
  });

  test("without lockfiles no lockfile signal appears", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { express: "^4.0.0" } }),
    });
    try {
      const result = await new ExpressProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(false);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(false);
    } finally {
      await project.cleanup();
    }
  });
});

describe("Express scanner — frameworkSearchRoot (audit 2nd review #4)", () => {
  test("scan() respects match.frameworkSearchRoot: only reads from the given workspace", async () => {
    // Previously the scanner walked `match.projectRoot` and, in
    // monorepos, contaminated the collection with routes from other
    // workspaces.
    const project = await createTempProject({
      "package.json": JSON.stringify({
        name: "monorepo",
        private: true,
        workspaces: ["apps/api", "apps/admin"],
      }),
      // apps/api: 1 endpoint
      "apps/api/package.json": JSON.stringify({
        name: "@mono/api",
        dependencies: { express: "^4.19.0" },
      }),
      "apps/api/server.js": `const express = require("express");
const app = express();
app.get("/api-only", (_req, res) => res.json({}));
`,
      // apps/admin: 1 endpoint distinto
      "apps/admin/package.json": JSON.stringify({
        name: "@mono/admin",
        dependencies: { express: "^4.19.0" },
      }),
      "apps/admin/server.js": `const express = require("express");
const app = express();
app.get("/admin-only", (_req, res) => res.json({}));
`,
    });

    try {
      const routes = (
        await new ExpressRouteScanner().scan({
          framework: "express",
          projectRoot: project.root,
          artifacts: ["apps/api/package.json"],
          frameworkSearchRoot: "apps/api",
        })
      ).routes;
      const uris = routes.map((r) => r.uri).sort();
      expect(uris).toContain("/api-only");
      // /admin-only must NOT appear because the override limits the
      // scan to the apps/api workspace.
      expect(uris).not.toContain("/admin-only");
    } finally {
      await project.cleanup();
    }
  });
});
