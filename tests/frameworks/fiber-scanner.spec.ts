/**
 * Fiber (Go) scanner.
 *
 * Fiber copies the Express API but in Go. The Gin scanner is not
 * reused because the differences are not cosmetic: Fiber groups with
 * `app.Group("/api")` returning a chainable router, and its
 * validation tags are `validate:"…"` (go-playground/validator)
 * instead of Gin's `binding:"…"`.
 */
import { describe, expect, test } from "vitest";

import {
  FiberProjectScanner,
  FiberRouteScanner,
  FiberValidateTagProvider,
  parseGoStruct,
} from "../../packages/frameworks/scanners/fiber.scanner";
import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture, createTempProject } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir } from "../../scripts/helpers/root.helper";

describeScannerContract({
  framework: "fiber",
  fixtureRoot: comprehensiveFixture("fiber"),
  capabilities: { validation: true, pathParams: true, stripsComments: false },
  minimalProject: {
    "go.mod": "module demo\n\ngo 1.22\n\nrequire github.com/gofiber/fiber/v2 v2.52.0\n",
    "main.go":
      'package main\n\nimport "github.com/gofiber/fiber/v2"\n\nfunc main() {\n\tapp := fiber.New()\n\tapp.Get("/vivo", nil)\n\tapp.Listen(":3000")\n}\n',
  },
});

const FIXTURE = comprehensiveFixtureDir("fiber");

async function scanFixture() {
  const match = await new FiberProjectScanner().resolve(FIXTURE);
  const scanner = new FiberRouteScanner();
  const result = await scanner.scan(match);
  return { match, scanner, result, routes: result.routes };
}

describe("detection", () => {
  test("a go.mod containing gofiber scores 1", async () => {
    expect((await new FiberProjectScanner().detect(FIXTURE)).score).toBe(1);
  });

  test("a Gin project is not Fiber", async () => {
    expect((await new FiberProjectScanner().detect(comprehensiveFixtureDir("gin"))).score).toBe(0);
  });
});

describe("routes", () => {
  test("the Group prefix is applied", async () => {
    const { routes } = await scanFixture();
    expect(routes.every((r) => r.uri.startsWith("/api/"))).toBe(true);
  });

  test("finds the seven endpoints of the fixture", async () => {
    const { routes } = await scanFixture();
    expect(routes).toHaveLength(7);
  });

  test("methods are uppercase even though Go writes them capitalized", async () => {
    const { routes } = await scanFixture();
    expect(routes.every((r) => r.method === r.method.toUpperCase())).toBe(true);
  });

  // The regression that took the machine down: `bodyStructNear` shared
  // the `lastIndex` of the outer loop regex and reset it to the start of
  // the current match, so the loop kept finding the SAME route forever.
  // Infinite loop and memory until the OS kills the process. If it
  // returns, this test never finishes.
  test("the scan finishes", async () => {
    const { routes } = await scanFixture();
    expect(routes.length).toBeGreaterThan(0);
  }, 15_000);
});

describe("validate: tags from go-playground/validator", () => {
  test("resolves the body struct of a POST", async () => {
    const { match, result, routes } = await scanFixture();
    const provider = new FiberValidateTagProvider();
    const post = routes.find((r) => r.method === "POST" && r.uri === "/api/users")!;

    const { fields } = await provider.resolve(post, match, result);
    const byName = new Map(fields.map((f) => [f.fieldName, f]));
    expect(byName.get("email")?.required).toBe(true);
    expect(byName.get("email")?.format).toBe("email");
    expect(byName.get("age")?.required).toBe(false);
    expect(byName.get("role")?.enumValues).toEqual(["admin", "user", "guest"]);
  });

  test("a GET without a struct does not fake rules", async () => {
    const { match, result, routes } = await scanFixture();
    const provider = new FiberValidateTagProvider();
    const health = routes.find((r) => r.uri === "/api/health")!;
    expect(await provider.supports(health, match, result)).toBe(false);
  });

  test("two concurrent scans do not mix structs", async () => {
    const projects = await Promise.all([
      createTempProject({
        "go.mod": "module fiber-a\n\nrequire github.com/gofiber/fiber/v2 v2.52.0\n",
        "main.go": 'package main\n\nimport "github.com/gofiber/fiber/v2"\n\ntype CreateA struct { TagA string `json:"tag_a"` }\nfunc main() { app := fiber.New(); app.Post("/a", func(c *fiber.Ctx) error { var body CreateA; return c.BodyParser(&body) }) }\n',
      }, "fiber-concurrent-a-"),
      createTempProject({
        "go.mod": "module fiber-b\n\nrequire github.com/gofiber/fiber/v2 v2.52.0\n",
        "main.go": 'package main\n\nimport "github.com/gofiber/fiber/v2"\n\ntype CreateB struct { TagB string `json:"tag_b"` }\nfunc main() { app := fiber.New(); app.Post("/b", func(c *fiber.Ctx) error { var body CreateB; return c.BodyParser(&body) }) }\n',
      }, "fiber-concurrent-b-"),
    ]);
    try {
      const results = await Promise.all(projects.map(async (project) => {
        const match = await new FiberProjectScanner().resolve(project.root);
        return new FiberRouteScanner().scan(match);
      }));
      expect(results[0]?.structs?.get("POST /a")?.name).toBe("CreateA");
      expect(results[0]?.structs?.has("POST /b")).toBe(false);
      expect(results[1]?.structs?.get("POST /b")?.name).toBe("CreateB");
      expect(results[1]?.structs?.has("POST /a")).toBe(false);
    } finally {
      await Promise.all(projects.map((project) => project.cleanup()));
    }
  });
});

describe("parseGoStruct", () => {
  const source = `
type Ejemplo struct {
	Nombre   string   \`json:"nombre" validate:"required,max=50"\`
	Edad     int      \`json:"edad" validate:"min=0"\`
	Activo   bool     \`json:"activo"\`
	Tags     []string \`json:"tags"\`
	Interno  string   \`json:"-"\`
	SinTag   string
}
`;

  // The name that travels over the wire is the one in the `json` tag,
  // not the Go field name: sending "Nombre" instead of "nombre"
  // yields a 422.
  test("uses the json tag name, not the field name", () => {
    expect(parseGoStruct(source, "Ejemplo").map((f) => f.fieldName)).toContain("nombre");
  });

  test("maps the Go types", () => {
    const byName = new Map(parseGoStruct(source, "Ejemplo").map((f) => [f.fieldName, f.type]));
    expect(byName.get("nombre")).toBe("string");
    expect(byName.get("edad")).toBe("integer");
    expect(byName.get("activo")).toBe("boolean");
    expect(byName.get("tags")).toBe("array");
  });

  // `json:"-"` means "this field is not serialized": sending it would
  // be inventing a field the API does not expect.
  test("omits the fields marked with json:\"-\"", () => {
    expect(parseGoStruct(source, "Ejemplo").map((f) => f.fieldName)).not.toContain("-");
  });

  test("a struct that does not exist returns empty", () => {
    expect(parseGoStruct(source, "NoExiste")).toEqual([]);
  });
});
