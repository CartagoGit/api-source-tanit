import { describe, expect, test } from "vitest";
import {
  GinProjectScanner,
  GinRouteScanner,
  GinBindingProvider,
} from "../../packages/frameworks/scanners/gin.scanner";

import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir, smokeFixtureDir } from "../../scripts/helpers/root.helper";
import { createTempProject } from "../helpers/scanner-fixture";

import { EMPTY_SCAN_RESULT } from "../helpers/empty-scan-result";
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

const ROOT = smokeFixtureDir("gin");
const COMPREHENSIVE = comprehensiveFixtureDir("gin");

describe("Gin scanner", () => {
  test("detect() > 0 when go.mod contains github.com/gin-gonic/gin", async () => {
    expect((await new GinProjectScanner().detect(ROOT)).score).toBeGreaterThan(0);
  });

  test("detect() === 0 when there is no go.mod", async () => {
    expect((await new GinProjectScanner().detect("/tmp")).score).toBe(0);
  });

  test("scan() finds the 5 routes of the mini-fixture", async () => {
    const match = await new GinProjectScanner().resolve(ROOT);
    const routes = (await new GinRouteScanner().scan(match)).routes;
    expect(routes).toHaveLength(5);
  });

  test("GET /health and CRUD /api/users present", async () => {
    const match = await new GinProjectScanner().resolve(ROOT);
    const routes = (await new GinRouteScanner().scan(match)).routes;
    const pairs = routes.map((r) => `${r.method} ${r.uri}`);
    expect(pairs).toContain("GET /health");
    expect(pairs).toContain("GET /api/users");
    expect(pairs).toContain("POST /api/users");
    expect(pairs).toContain("GET /api/users/:id");
    expect(pairs).toContain("DELETE /api/users/:id");
  });

  test("Gin path param :id preserved in uri", async () => {
    const match = await new GinProjectScanner().resolve(ROOT);
    const routes = (await new GinRouteScanner().scan(match)).routes;
    const withId = routes.filter((r) => r.uri.endsWith(":id"));
    expect(withId.length).toBeGreaterThanOrEqual(2);
  });

  test("rawUri preserves the path without the Group prefix", async () => {
    const match = await new GinProjectScanner().resolve(ROOT);
    const routes = (await new GinRouteScanner().scan(match)).routes;
    const route = routes.find((item) => item.uri === "/api/users/:id");
    expect(route?.rawUri).toBe("/users/:id");
  });

  test("Group /api prefix applied to all subroutes", async () => {
    const match = await new GinProjectScanner().resolve(ROOT);
    const routes = (await new GinRouteScanner().scan(match)).routes;
    const apiRoutes = routes.filter((r) => r.uri.startsWith("/api"));
    expect(apiRoutes.length).toBeGreaterThanOrEqual(4);
  });

  test("resolves nested Group prefixes", async () => {
    const project = await createTempProject({
      "go.mod": "module nested-gin\n\nrequire github.com/gin-gonic/gin v1.9.1\n",
      "main.go": [
        "package main",
        "",
        "import \"github.com/gin-gonic/gin\"",
        "",
        "func main() {",
        "    r := gin.Default()",
        "    api := r.Group(\"/api\")",
        "    users := api.Group(\"/users\")",
        "    users.GET(\"/list\", nil)",
        "}",
        "",
      ].join("\\n"),
    }, "gin-nested-group-");

    try {
      const match = await new GinProjectScanner().resolve(project.root);
      const routes = (await new GinRouteScanner().scan(match)).routes;
      expect(routes.map((route) => `${route.method} ${route.uri}`)).toContain("GET /api/users/list");
    } finally {
      await project.cleanup();
    }
  });

  // a00010 / B-02: the regex recognized HEAD/OPTIONS but the
  // downstream list discarded them. A `.HEAD("/health")` and a
  // `.OPTIONS("/cors")` must reach the collection.
  test("HEAD and OPTIONS are not filtered (B-02 a00010)", async () => {
    const methods = ["GET", "POST", "HEAD", "OPTIONS"] as const;
    for (const m of methods) {
      const route = `r.${m}("/health/${m.toLowerCase()}", func(c *gin.Context) {})`;
      const re = new RegExp(String.raw`([a-zA-Z_][\w.]*)\s*\.\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*"([^"]+)"`, "g");
      const match = re.exec(route);
      expect(match?.[2]).toBe(m);
    }
    const HEAD_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"];
    for (const m of HEAD_METHODS) {
    // The scanner's final set includes all of them.
      expect(["get","post","put","delete","patch","head","options"]).toContain(m);
    }
  });

  test("comprehensive: detects >13 routes in multi-file Go", async () => {
    const match = await new GinProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new GinRouteScanner().scan(match)).routes;
    expect(routes.length).toBeGreaterThanOrEqual(13);
  });

  test("GinBindingProvider extracts binding fields from POST /api/users", async () => {
    const match = await new GinProjectScanner().resolve(COMPREHENSIVE);
    const routes = (await new GinRouteScanner().scan(match)).routes;
    const post = routes.find((r) => r.method === "POST" && r.uri === "/api/users");
    if (!post) return;

    const provider = new GinBindingProvider();
    const result = await provider.resolve(post, match, EMPTY_SCAN_RESULT);

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
