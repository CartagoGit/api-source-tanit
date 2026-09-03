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
import { comprehensiveFixture, createTempProject } from "../helpers/scanner-fixture";
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
  const result = await scanner.scan(match);
  return { match, scanner, result, routes: result.routes };
}

describe("detección", () => {
  test("un proyecto con `hono` puntúa 1", async () => {
    expect((await new HonoProjectScanner().detect(FIXTURE)).score).toBe(1);
  });

  test("un proyecto sin hono no puntúa", async () => {
    expect((await new HonoProjectScanner().detect(comprehensiveFixtureDir("gin"))).score).toBe(0);
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
    const { match, result, routes } = await scanFixture();
    const provider = new HonoZodValidatorProvider();
    const post = routes.find((r) => r.method === "POST" && r.uri === "/api/users")!;

    const { fields } = await provider.resolve(post, match, result);
    const byName = new Map(fields.map((f) => [f.fieldName, f]));
    expect([...byName.keys()].sort()).toEqual(["age", "email", "name", "role"]);
    expect(byName.get("email")?.required).toBe(true);
    expect(byName.get("age")?.required).toBe(false);
  });

  // `zValidator("query", …)` no valida el body: sus campos son query.
  test("el target del validador decide dónde van los campos", async () => {
    const { match, result, routes } = await scanFixture();
    const provider = new HonoZodValidatorProvider();
    const get = routes.find((r) => r.method === "GET" && r.uri === "/api/users")!;

    const { fields } = await provider.resolve(get, match, result);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((f) => f.location === "query")).toBe(true);
  });

  // La regresión: con una ventana de caracteres, una ruta sin validador
  // se quedaba con el de la siguiente y salía con reglas ajenas.
  test("una ruta sin validador no hereda el de otra", async () => {
    const { match, result, routes } = await scanFixture();
    const provider = new HonoZodValidatorProvider();
    const health = routes.find((r) => r.uri === "/api/health")!;
    expect(await provider.supports(health, match, result)).toBe(false);
  });

  test("dos escaneos concurrentes no mezclan validators", async () => {
    const projects = await Promise.all([
      createTempProject({
        "package.json": '{"dependencies":{"hono":"^4.6.0"}}',
        "index.ts": 'import { Hono } from "hono";\nconst app = new Hono();\napp.post("/a", zValidator("json", tag_a));\n',
      }, "hono-concurrent-a-"),
      createTempProject({
        "package.json": '{"dependencies":{"hono":"^4.6.0"}}',
        "index.ts": 'import { Hono } from "hono";\nconst app = new Hono();\napp.post("/b", zValidator("json", tag_b));\n',
      }, "hono-concurrent-b-"),
    ]);
    try {
      const results = await Promise.all(projects.map(async (project) => {
        const match = await new HonoProjectScanner().resolve(project.root);
        return new HonoRouteScanner().scan(match);
      }));
      expect(results[0]?.validators?.get("POST /a")?.name).toBe("tag_a");
      expect(results[0]?.validators?.has("POST /b")).toBe(false);
      expect(results[1]?.validators?.get("POST /b")?.name).toBe("tag_b");
      expect(results[1]?.validators?.has("POST /a")).toBe(false);
    } finally {
      await Promise.all(projects.map((project) => project.cleanup()));
    }
  });
});

// ---------------------------------------------------------------------------
// f00011 S1 — regresiones de señales nuevas (wrangler.toml +
// frameworkSearchRoot).
// ---------------------------------------------------------------------------

describe("Hono — detect() por wrangler.toml (f00011 S1)", () => {
  // f00011 S1: `wrangler.toml` en raíz es la señal canónica de un
  // proyecto Cloudflare Workers (el caso de uso de Hono). Peso 0.6 —
  // alto, pero no tanto como la dependencia directa (1.0) porque
  // `wrangler.toml` también lo usan proyectos que no son hono.
  test("detect() === 1 (cap) cuando hay wrangler.toml + hono como dependencia", async () => {
    const project = await createTempProject({
      "package.json": '{"dependencies":{"hono":"^4.6.0"}}',
      "wrangler.toml": 'name = "demo"\nmain = "src/index.ts"\n',
    });
    try {
      // 1.0 (hono dep) + 0.6 (wrangler.toml) = 1.6 → cap 1.
      expect((await new HonoProjectScanner().detect(project.root)).score).toBe(1);
    } finally {
      await project.cleanup();
    }
  });

  test("detect() === 0.6 cuando solo hay wrangler.toml (sin hono declarado)", async () => {
    const project = await createTempProject({
      "package.json": '{"name":"demo"}',
      "wrangler.toml": 'name = "demo"\nmain = "src/index.ts"\n',
    });
    try {
      // Caso raro (un worker que aún no incluye la dependencia), pero
      // es la mejor pista disponible y por eso puntúa 0.6.
      expect((await new HonoProjectScanner().detect(project.root)).score).toBe(0.6);
    } finally {
      await project.cleanup();
    }
  });

  test("evidence incluye 'wrangler.toml presente' cuando aplica", async () => {
    const project = await createTempProject({
      "package.json": '{"dependencies":{"hono":"^4.6.0"}}',
      "wrangler.toml": 'name = "demo"\n',
    });
    try {
      const result = await new HonoProjectScanner().detect(project.root);
      const wranglerEvidence = result.evidence.find((e) =>
        e.signal.includes("wrangler.toml"),
      );
      expect(wranglerEvidence).toBeDefined();
      expect(wranglerEvidence?.weight).toBe(0.6);
    } finally {
      await project.cleanup();
    }
  });
});

describe("Hono — frameworkSearchRoot para monorepos (f00011 S1)", () => {
  // f00011 S1: en un monorepo `apps/api/` tiene el `index.ts` con
  // las rutas de Hono. Sin `frameworkSearchRoot` el scanner camina la
  // raíz y no encuentra nada; con él, sale el scan del subdir.
  test("scan() encuentra rutas cuando frameworkSearchRoot apunta al subdir con index.ts", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ workspaces: ["apps/*"] }),
      "apps/api/package.json": '{"dependencies":{"hono":"^4.6.0"}}',
      "apps/api/wrangler.toml": 'name = "demo"\n',
      "apps/api/index.ts":
        'import { Hono } from "hono";\nconst app = new Hono();\napp.get("/health", (c) => c.json({}));\nexport default app;\n',
    });
    try {
      const match = await new HonoProjectScanner().resolve(project.root);
      const routes = (await new HonoRouteScanner().scan({
        ...match,
        frameworkSearchRoot: "apps/api",
      })).routes;
      const pairs = routes.map((r) => `${r.method} ${r.uri}`);
      expect(pairs).toContain("GET /health");
    } finally {
      await project.cleanup();
    }
  });
});
