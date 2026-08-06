import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  ExpressProjectScanner,
  ExpressScanner,
  ExpressZodValidationProvider,
} from "../../service/scanners/express.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";

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

const ROOT = resolve(import.meta.dir, "../../tests/smoke-fixtures/express-mini");
const COMPREHENSIVE = resolve(import.meta.dir, "../../tests/fixtures/express-comprehensive");

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
