import { describe, expect, test } from "vitest";
import { resolve } from "node:path";
import {
  ExpressProjectScanner,
  ExpressScanner,
  ExpressZodValidationProvider,
} from "../../frameworks/scanners/express.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import {
  comprehensiveFixture,
  createTempProject,
  scanProject,
} from "../helpers/scanner-fixture";
import { moduleDir } from "../../helpers/module-path.helper";

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

const ROOT = resolve(moduleDir(import.meta.url), "../../tests/smoke-fixtures/express-mini");
const COMPREHENSIVE = resolve(moduleDir(import.meta.url), "../../tests/fixtures/express-comprehensive");

describe("Express scanner", () => {
  test("detect() > 0 cuando package.json tiene 'express'", async () => {
    expect(await new ExpressProjectScanner().detect(ROOT)).toBeGreaterThan(0);
  });

  test("detect() === 0 en directorio sin package.json", async () => {
    expect(await new ExpressProjectScanner().detect("/tmp")).toBe(0);
  });

  test("scan() encuentra las 5 rutas del mini-fixture", async () => {
    const match = await new ExpressProjectScanner().resolve(ROOT);
    const routes = await new ExpressScanner().scan(match);
    expect(routes).toHaveLength(5);
  });

  test("GET /health y GET/POST /api/users están presentes", async () => {
    const match = await new ExpressProjectScanner().resolve(ROOT);
    const routes = await new ExpressScanner().scan(match);
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /health");
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
  });

  test("path param :id en app.get('/api/users/:id') → uri con :id", async () => {
    const match = await new ExpressProjectScanner().resolve(ROOT);
    const routes = await new ExpressScanner().scan(match);
    const withId = routes.filter((r) => r.uri.includes(":id"));
    expect(withId.length).toBeGreaterThanOrEqual(2);
  });

  test("comprehensive: detecta >10 rutas de router encadenado", async () => {
    const match = await new ExpressProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new ExpressScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  test("zod provider resuelve campos del body para POST", async () => {
    const match = await new ExpressProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new ExpressScanner().scan(match);
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
});
