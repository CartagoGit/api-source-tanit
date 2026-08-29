import { describe, expect, test } from "vitest";
import {
  FastApiProjectScanner,
  FastApiRouteScanner,
  FastApiPydanticValidationProvider,
} from "../../packages/frameworks/scanners/fastapi.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";

describeScannerContract({
  framework: "fastapi",
  fixtureRoot: comprehensiveFixture("fastapi"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: true,
  },
  minimalProject: {
    "requirements.txt": 'fastapi\n',
    "main.py": "from fastapi import FastAPI\napp = FastAPI()\n\n@app.get('/vivo')\ndef vivo():\n    return {}\n",
  },
  commentedEndpoint: {
    file: 'main.py',
    source: "# @app.get('/endpoint-comentado')",
  },
});

const ROOT = smokeFixtureDir("fastapi");
const COMPREHENSIVE = comprehensiveFixtureDir("fastapi");

describe("FastAPI scanner", () => {
  test("detect() > 0 cuando requirements.txt tiene 'fastapi'", async () => {
    expect(await new FastApiProjectScanner().detect(ROOT)).toBeGreaterThan(0);
  });

  test("detect() === 0 cuando no hay requirements.txt ni pyproject.toml", async () => {
    expect(await new FastApiProjectScanner().detect("/tmp")).toBe(0);
  });

  test("scan() encuentra las 4 rutas del mini-fixture", async () => {
    const match = await new FastApiProjectScanner().resolve(ROOT);
    const routes = await new FastApiRouteScanner().scan(match);
    expect(routes).toHaveLength(4);
  });

  test("GET /health, GET /api/users, POST /api/users, GET /api/users/{user_id}", async () => {
    const match = await new FastApiProjectScanner().resolve(ROOT);
    const routes = await new FastApiRouteScanner().scan(match);
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /health");
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
    const showRoute = routes.find((r) => r.method === "GET" && r.uri.includes("{user_id}"));
    expect(showRoute).toBeDefined();
  });

  test("path param {user_id} preservado tal como lo escribe el dev", async () => {
    const match = await new FastApiProjectScanner().resolve(ROOT);
    const routes = await new FastApiRouteScanner().scan(match);
    const show = routes.find((r) => r.uri.includes("{user_id}"));
    expect(show?.uri).toContain("{user_id}");
  });

  test("comprehensive: detecta >10 rutas con @router decorators y prefijos", async () => {
    const match = await new FastApiProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new FastApiRouteScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  test("Pydantic provider resuelve campos de BaseModel para POST", async () => {
    const match = await new FastApiProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new FastApiRouteScanner().scan(match);
    const post = routes.find((r) => r.method === "POST" && r.uri.includes("users"));
    if (!post) return;
    const provider = new FastApiPydanticValidationProvider();
    const result = await provider.resolve(post, match);
    expect(result.fields.length).toBeGreaterThan(0);
    const names = result.fields.map((f) => f.fieldName);
    expect(names).toContain("name");
    expect(names).toContain("email");
  });
});
