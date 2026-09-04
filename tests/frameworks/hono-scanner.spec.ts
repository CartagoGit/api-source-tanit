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

  test("detect() === 0 cuando solo hay wrangler.toml (sin hono declarado) — audit 2026-09-04 P2 #8", async () => {
    // Antes este caso puntuaba 0.6 y clasificaba proyectos
    // itty-router / vanilla Workers / Remix on Cloudflare como
    // Hono. Ahora wrangler.toml solo NO es evidencia de framework;
    // queda como bonus de runtime cuando ya hay `hono` declarado.
    const project = await createTempProject({
      "package.json": '{"name":"demo"}',
      "wrangler.toml": 'name = "demo"\nmain = "src/index.ts"\n',
    });
    try {
      expect((await new HonoProjectScanner().detect(project.root)).score).toBe(0);
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

// ---------------------------------------------------------------------------
// f00011 S4 — lockfiles como bonus de scoring en detect().
// ---------------------------------------------------------------------------

describe("Hono — lockfiles como bonus de runtime (f00011 S4)", () => {
  // f00011 S4: `pnpm-lock.yaml` y `bun.lockb` afinan la confianza
  // del detector sin ser detección. Pesos pequeños: +0.1 (pnpm),
  // +0.15 (bun). El cap a 1 del `withEvidence` ya absorbe el caso
  // de un Hono con `hono` declarado; el bonus queda en `evidence`
  // aunque no cambie el score visible. Bun es especialmente
  // relevante aquí — Hono es first-class en Bun.
  test("pnpm-lock.yaml añade evidencia con peso 0.1", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { hono: "^4.6.0" } }),
      "pnpm-lock.yaml": "",
    });
    try {
      const result = await new HonoProjectScanner().detect(project.root);
      const pnpm = result.evidence.find((e) => e.artifact === "pnpm-lock.yaml");
      expect(pnpm).toBeDefined();
      expect(pnpm?.weight).toBe(0.1);
    } finally {
      await project.cleanup();
    }
  });

  test("bun.lockb añade evidencia con peso 0.15", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { hono: "^4.6.0" } }),
      "bun.lockb": "",
    });
    try {
      const result = await new HonoProjectScanner().detect(project.root);
      const bun = result.evidence.find((e) => e.artifact === "bun.lockb");
      expect(bun).toBeDefined();
      expect(bun?.weight).toBe(0.15);
    } finally {
      await project.cleanup();
    }
  });

  test("pnpm-lock.yaml + bun.lockb suman ambas señales", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { hono: "^4.6.0" } }),
      "pnpm-lock.yaml": "",
      "bun.lockb": "",
    });
    try {
      const result = await new HonoProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(true);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(true);
    } finally {
      await project.cleanup();
    }
  });

  test("sin lockfiles no aparece ninguna señal de lockfile", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { hono: "^4.6.0" } }),
    });
    try {
      const result = await new HonoProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(false);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(false);
    } finally {
      await project.cleanup();
    }
  });
});
