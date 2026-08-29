/**
 * Scanner de Hono.
 *
 * Hono es el framework de los runtimes de borde (Workers, Deno, Bun).
 * Se parece a Express, pero dos cosas rompen un scanner escrito para
 * Express:
 *
 *   - **Encadena**: `app.get("/a", h).get("/b", h)` es una expresión y
 *     dos rutas, y el segundo `.get` no tiene identificador delante.
 *   - **Monta sub-apps** con `app.route("/api", sub)`, que es su forma
 *     de poner prefijo.
 */
import { describe, expect, test } from "vitest";

import {
  HonoProjectScanner,
  HonoRouteScanner,
  HonoZodValidatorProvider,
} from "../../packages/frameworks/scanners/hono.scanner";
import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir } from "../../scripts/helpers/root.helper";

describeScannerContract({
  framework: "hono",
  fixtureRoot: comprehensiveFixture("hono"),
  capabilities: { validation: true, pathParams: true, stripsComments: true },
  minimalProject: {
    "package.json": '{"name":"mini","type":"module","dependencies":{"hono":"^4.6.0"}}',
    "index.ts":
      'import { Hono } from "hono";\nconst app = new Hono();\napp.get("/vivo", (c) => c.json({}));\nexport default app;\n',
  },
  commentedEndpoint: {
    file: "index.ts",
    source: '// app.get("/endpoint-comentado", (c) => c.json({}));',
  },
});

const FIXTURE = comprehensiveFixtureDir("hono");

async function scanFixture() {
  const match = await new HonoProjectScanner().resolve(FIXTURE);
  const scanner = new HonoRouteScanner();
  const routes = await scanner.scan(match);
  return { match, scanner, routes };
}

describe("detección", () => {
  test("un proyecto con `hono` puntúa 1", async () => {
    expect(await new HonoProjectScanner().detect(FIXTURE)).toBe(1);
  });

  test("un proyecto sin hono no puntúa", async () => {
    expect(await new HonoProjectScanner().detect(comprehensiveFixtureDir("gin"))).toBe(0);
  });
});

describe("formas propias de Hono", () => {
  // La razón de tener scanner propio: el de Express busca
  // `<ident>.method(`, y en una cadena el segundo `.get` no lo tiene.
  test("las rutas encadenadas cuentan todas", async () => {
    const { routes } = await scanFixture();
    for (const uri of ["/api/health", "/api/status", "/api/version"]) {
      expect(routes.some((r) => r.uri === uri), uri).toBe(true);
    }
  });

  test("el prefijo del `route()` se aplica", async () => {
    const { routes } = await scanFixture();
    expect(routes.every((r) => r.uri.startsWith("/api/"))).toBe(true);
  });

  test("los path params se conservan", async () => {
    const { routes } = await scanFixture();
    expect(routes.some((r) => r.uri.includes(":id"))).toBe(true);
  });

  test("no se repite ninguna ruta", async () => {
    const { routes } = await scanFixture();
    const keys = routes.map((r) => `${r.method} ${r.uri}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("validación con @hono/zod-validator", () => {
  test("resuelve el esquema de un POST", async () => {
    const { match, scanner, routes } = await scanFixture();
    const provider = new HonoZodValidatorProvider(scanner);
    const post = routes.find((r) => r.method === "POST" && r.uri === "/api/users")!;

    const { fields } = await provider.resolve(post, match);
    const byName = new Map(fields.map((f) => [f.fieldName, f]));
    expect([...byName.keys()].sort()).toEqual(["age", "email", "name", "role"]);
    expect(byName.get("email")?.required).toBe(true);
    expect(byName.get("age")?.required).toBe(false);
  });

  // `zValidator("query", …)` no valida el body: sus campos son query.
  test("el target del validador decide dónde van los campos", async () => {
    const { match, scanner, routes } = await scanFixture();
    const provider = new HonoZodValidatorProvider(scanner);
    const get = routes.find((r) => r.method === "GET" && r.uri === "/api/users")!;

    const { fields } = await provider.resolve(get, match);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((f) => f.location === "query")).toBe(true);
  });

  // La regresión: con una ventana de caracteres, una ruta sin validador
  // se quedaba con el de la siguiente y salía con reglas ajenas.
  test("una ruta sin validador no hereda el de otra", async () => {
    const { match, scanner, routes } = await scanFixture();
    const provider = new HonoZodValidatorProvider(scanner);
    const health = routes.find((r) => r.uri === "/api/health")!;
    expect(await provider.supports(health, match)).toBe(false);
  });
});
