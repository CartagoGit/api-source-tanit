import { describe, expect, test } from "vitest";
import { resolve } from "node:path";
import {
  GinProjectScanner,
  GinRouteScanner,
  GinBindingProvider,
} from "../../service/scanners/gin.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";
import { moduleDir } from "../../helper/module-path.helper";

describeScannerContract({
  framework: "gin",
  fixtureRoot: comprehensiveFixture("gin"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: true,
  },
  minimalProject: {
    "go.mod": 'module demo\n\nrequire github.com/gin-gonic/gin v1.9.1\n',
    "cmd/server/main.go": 'package main\n\nimport "github.com/gin-gonic/gin"\n\nfunc main() {\n\tr := gin.Default()\n\tr.GET("/vivo", nil)\n\tr.Run()\n}\n',
  },
  commentedEndpoint: {
    file: 'cmd/server/main.go',
    source: '\t// r.GET("/endpoint-comentado", nil)',
  },
});

const ROOT = resolve(moduleDir(import.meta.url), "../../tests/smoke-fixtures/gin-mini");
const COMPREHENSIVE = resolve(moduleDir(import.meta.url), "../../tests/fixtures/gin-comprehensive");

describe("Gin scanner", () => {
  test("detect() > 0 cuando go.mod tiene github.com/gin-gonic/gin", async () => {
    expect(await new GinProjectScanner().detect(ROOT)).toBeGreaterThan(0);
  });

  test("detect() === 0 cuando no hay go.mod", async () => {
    expect(await new GinProjectScanner().detect("/tmp")).toBe(0);
  });

  test("scan() encuentra las 5 rutas del mini-fixture", async () => {
    const match = await new GinProjectScanner().resolve(ROOT);
    const routes = await new GinRouteScanner().scan(match);
    expect(routes).toHaveLength(5);
  });

  test("GET /health y CRUD /api/users presentes", async () => {
    const match = await new GinProjectScanner().resolve(ROOT);
    const routes = await new GinRouteScanner().scan(match);
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /health");
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
    expect(pairs).toContain("GET /api/users/:id");
    expect(pairs).toContain("DELETE /api/users/:id");
  });

  test("path param Gin :id preservado en uri", async () => {
    const match = await new GinProjectScanner().resolve(ROOT);
    const routes = await new GinRouteScanner().scan(match);
    const withId = routes.filter((r) => r.uri.endsWith(":id"));
    expect(withId.length).toBeGreaterThanOrEqual(2);
  });

  test("prefijo de Group /api aplicado a todas las subrutas", async () => {
    const match = await new GinProjectScanner().resolve(ROOT);
    const routes = await new GinRouteScanner().scan(match);
    const apiRoutes = routes.filter((r) => r.uri.startsWith("/api"));
    expect(apiRoutes.length).toBeGreaterThanOrEqual(4);
  });

  test("comprehensive: detecta >13 rutas en multi-file Go", async () => {
    const match = await new GinProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new GinRouteScanner().scan(match);
    expect(routes.length).toBeGreaterThanOrEqual(13);
  });

  test("GinBindingProvider extrae campos binding de POST /api/users", async () => {
    const match = await new GinProjectScanner().resolve(COMPREHENSIVE);
    const routes = await new GinRouteScanner().scan(match);
    const post = routes.find((r) => r.method === "POST" && r.uri === "/api/users");
    if (!post) return;

    const provider = new GinBindingProvider();
    const result = await provider.resolve(post, match);

    expect(result.fields.length).toBeGreaterThan(0);
    const names = result.fields.map((field) => field.fieldName);
    expect(names).toContain("name");
    expect(names).toContain("email");
    expect(names).toContain("age");
    expect(names).toContain("role");

    const emailField = result.fields.find((field) => field.fieldName === "email");
    expect(emailField?.format).toBe("email");
    const roleField = result.fields.find((field) => field.fieldName === "role");
    expect(roleField?.type).toBe("enum");
    expect(roleField?.enumValues).toEqual(["admin", "user", "guest"]);
  });
});
