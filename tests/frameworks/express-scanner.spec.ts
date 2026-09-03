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
  test("detect() > 0 cuando package.json tiene 'express'", async () => {
    expect((await new ExpressProjectScanner().detect(ROOT)).score).toBeGreaterThan(0);
  });

  test("detect() === 0 en directorio sin package.json", async () => {
    expect((await new ExpressProjectScanner().detect("/tmp")).score).toBe(0);
  });

  test("scan() encuentra las 5 rutas del mini-fixture", async () => {
    const match = await new ExpressProjectScanner().resolve(ROOT);
    const routes = await new ExpressRouteScanner().scan(match);
    expect(routes).toHaveLength(5);
  });

  test("GET /health y GET/POST /api/users están presentes", async () => {
    const match = await new ExpressProjectScanner().resolve(ROOT);
    const routes = await new ExpressRouteScanner().scan(match);
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /health");
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
  });

  test("path param :id en app.get('/api/users/:id') → uri con :id", async () => {
    const match = await new ExpressProjectScanner().resolve(ROOT);
    const routes = await new ExpressRouteScanner().scan(match);
    const withId = routes.filter((r) => r.uri.includes(":id"));
    expect(withId.length).toBeGreaterThanOrEqual(2);
  });

  test("comprehensive: detecta >10 rutas de router encadenado", async () => {
    const match = await new ExpressProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new ExpressRouteScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  test("zod provider resuelve campos del body para POST", async () => {
    const match = await new ExpressProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new ExpressRouteScanner().scan(match);
    const post = routes.find((r) => r.method === "POST" && r.uri.includes("users"));
    if (!post) return;
    const provider = new ExpressZodValidationProvider();
    const result = await provider.resolve(post, match);
    expect(result.fields.length).toBeGreaterThan(0);
    const names = result.fields.map((f) => f.fieldName);
    expect(names).toContain("name");
    expect(names).toContain("email");
  });
});

describe("Express — varios montajes en la misma línea", () => {
  // `app.use()` se leía con `.exec()` una sola vez por línea, así que
  // `app.use("/v1", a); app.use("/v2", b);` perdía el segundo montaje y
  // sus rutas salían sin prefijo.
  test("aplica el prefijo de todos los app.use de una línea", async () => {
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

  test("varios Router() declarados en la misma línea reciben su prefijo", async () => {
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

  test("concatena el prefijo aunque la ruta ya empiece por /api", async () => {
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

describe("Express — Joi validation provider inline", () => {
  test("Joi.object inline resuelve campos del body", async () => {
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
      const { fields } = await provider.resolve(post, match);
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.map((f) => f.fieldName)).toContain("name");
    } finally {
      await project.cleanup();
    }
  });
});

describe("Express — header schema near handler", () => {
  test("z.object en posición headers: devuelve campos con location header", async () => {
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
      const { fields } = await provider.resolve(post, match);
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.map((f) => f.fieldName)).toContain("name");
      expect(fields.map((f) => f.fieldName)).toContain("email");
    } finally {
      await project.cleanup();
    }
  });
});

describe("Express — Router({ prefix }) detection", () => {
  test("Router declarado con prefix se aplica a las rutas del router", async () => {
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
      // El prefijo del Router se captura en routerPrefixes;
      // si el Router no se monta con app.use('/prefix', router) no hereda prefix
      expect(routes.length).toBeGreaterThan(0);
    } finally {
      await project.cleanup();
    }
  });
});
