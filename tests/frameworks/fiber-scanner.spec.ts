/**
 * Scanner de Fiber (Go).
 *
 * Fiber copia la API de Express pero en Go. No se reutiliza el scanner
 * de Gin porque las diferencias no son cosméticas: Fiber agrupa con
 * `app.Group("/api")` devolviendo un router encadenable, y sus tags de
 * validación son `validate:"…"` (go-playground/validator) en vez del
 * `binding:"…"` de Gin.
 */
import { describe, expect, test } from "vitest";

import {
  FiberProjectScanner,
  FiberRouteScanner,
  FiberValidateTagProvider,
  parseGoStruct,
} from "../../packages/frameworks/scanners/fiber.scanner";
import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";
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

describe("detección", () => {
  test("un go.mod con gofiber puntúa 1", async () => {
    expect((await new FiberProjectScanner().detect(FIXTURE)).score).toBe(1);
  });

  test("un proyecto de Gin no es Fiber", async () => {
    expect((await new FiberProjectScanner().detect(comprehensiveFixtureDir("gin"))).score).toBe(0);
  });
});

describe("rutas", () => {
  test("el prefijo del Group se aplica", async () => {
    const { routes } = await scanFixture();
    expect(routes.every((r) => r.uri.startsWith("/api/"))).toBe(true);
  });

  test("encuentra los siete endpoints del fixture", async () => {
    const { routes } = await scanFixture();
    expect(routes).toHaveLength(7);
  });

  test("los métodos van en mayúscula aunque Go los escriba capitalizados", async () => {
    const { routes } = await scanFixture();
    expect(routes.every((r) => r.method === r.method.toUpperCase())).toBe(true);
  });

  // La regresión que tumbó la máquina: `bodyStructNear` compartía el
  // `lastIndex` del regex del bucle exterior y lo devolvía al inicio del
  // match actual, así que el bucle encontraba la MISMA ruta para
  // siempre. Bucle infinito y memoria hasta que el sistema mata el
  // proceso. Si vuelve, este test no termina.
  test("el escaneo termina", async () => {
    const { routes } = await scanFixture();
    expect(routes.length).toBeGreaterThan(0);
  }, 15_000);
});

describe("tags validate: de go-playground/validator", () => {
  test("resuelve el struct del body de un POST", async () => {
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

  test("un GET sin struct no finge reglas", async () => {
    const { match, result, routes } = await scanFixture();
    const provider = new FiberValidateTagProvider();
    const health = routes.find((r) => r.uri === "/api/health")!;
    expect(await provider.supports(health, match, result)).toBe(false);
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

  // El nombre que viaja por la red es el del tag `json`, no el del campo
  // de Go: mandar "Nombre" en vez de "nombre" da un 422.
  test("usa el nombre del tag json, no el del campo", () => {
    expect(parseGoStruct(source, "Ejemplo").map((f) => f.fieldName)).toContain("nombre");
  });

  test("mapea los tipos de Go", () => {
    const byName = new Map(parseGoStruct(source, "Ejemplo").map((f) => [f.fieldName, f.type]));
    expect(byName.get("nombre")).toBe("string");
    expect(byName.get("edad")).toBe("integer");
    expect(byName.get("activo")).toBe("boolean");
    expect(byName.get("tags")).toBe("array");
  });

  // `json:"-"` significa "este campo no se serializa": mandarlo sería
  // inventarse un campo que la API no espera.
  test("omite los campos marcados con json:\"-\"", () => {
    expect(parseGoStruct(source, "Ejemplo").map((f) => f.fieldName)).not.toContain("-");
  });

  test("un struct que no existe devuelve vacío", () => {
    expect(parseGoStruct(source, "NoExiste")).toEqual([]);
  });
});
