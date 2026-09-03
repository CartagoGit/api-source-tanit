/**
 * Scanner de Fastify.
 *
 * Fastify es el caso mejor de todos los de Node: lleva el esquema
 * **dentro** de la declaración de la ruta, y es JSON Schema, así que da
 * tipos exactos en vez de inferidos. Eso hay que aprovecharlo, y estos
 * tests fijan que se aproveche.
 *
 * Antes de existir este scanner, un proyecto Fastify lo recogía el de
 * Express, que lo reconocía por parecido de sintaxis y se perdía los
 * esquemas enteros.
 */
import { describe, expect, test } from "vitest";

import {
  FastifyProjectScanner,
  FastifyRouteScanner,
  FastifySchemaProvider,
  parseFastifySchema,
} from "../../packages/frameworks/scanners/fastify.scanner";
import { describeScannerContract } from "../helpers/scanner-contract";
import { comprehensiveFixture, createTempProject } from "../helpers/scanner-fixture";
import { comprehensiveFixtureDir } from "../../scripts/helpers/root.helper";

describeScannerContract({
  framework: "fastify",
  fixtureRoot: comprehensiveFixture("fastify"),
  capabilities: {
    validation: true,
    pathParams: true,
    stripsComments: true,
  },
  minimalProject: {
    "package.json": '{"name":"mini","dependencies":{"fastify":"^4.26.0"}}',
    "server.js":
      'import Fastify from "fastify";\nconst app = Fastify();\napp.get("/vivo", async () => ({}));\n',
  },
  commentedEndpoint: {
    file: "server.js",
    source: '// app.get("/endpoint-comentado", async () => ({}));',
  },
});

const FIXTURE = comprehensiveFixtureDir("fastify");

/** Escanea el fixture completo con una instancia limpia. */
async function scanFixture() {
  const detector = new FastifyProjectScanner();
  const match = await detector.resolve(FIXTURE);
  const scanner = new FastifyRouteScanner();
  const result = await scanner.scan(match);
  return { match, scanner, result, routes: result.routes };
}

describe("detección", () => {
  test("un proyecto con `fastify` puntúa 1", async () => {
    expect((await new FastifyProjectScanner().detect(FIXTURE)).score).toBe(1);
  });

  test("un proyecto sin fastify no puntúa", async () => {
    expect(
      (await new FastifyProjectScanner().detect(comprehensiveFixtureDir("django"))).score,
    ).toBe(0);
  });
});

describe("las tres formas de declarar una ruta", () => {
  test("la corta: app.get('/x')", async () => {
    const { routes } = await scanFixture();
    expect(routes.some((r) => r.method === "GET" && r.uri === "/api/health")).toBe(true);
  });

  test("la larga: app.route({ method, url })", async () => {
    const { routes } = await scanFixture();
    expect(routes.some((r) => r.method === "POST" && r.uri === "/api/auth/login")).toBe(
      true,
    );
  });

  // `method: ["GET", "HEAD"]` es una sola declaración y dos endpoints.
  test("la larga con varios métodos da un endpoint por método", async () => {
    const { routes } = await scanFixture();
    const status = routes.filter((r) => r.uri === "/api/status");
    expect(status.map((r) => r.method).sort()).toEqual(["GET", "HEAD"]);
  });

  test("el prefijo del `register` se aplica a todas", async () => {
    const { routes } = await scanFixture();
    expect(routes.every((r) => r.uri.startsWith("/api/"))).toBe(true);
  });

  test("no se repite ninguna ruta", async () => {
    const { routes } = await scanFixture();
    const keys = routes.map((r) => `${r.method} ${r.uri}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("esquemas JSON Schema de la propia ruta", () => {
  test("el provider resuelve la ruta que declara body", async () => {
    const { match, result, routes } = await scanFixture();
    const provider = new FastifySchemaProvider();
    const post = routes.find((r) => r.method === "POST" && r.uri === "/api/users")!;
    expect(await provider.supports(post, match, result)).toBe(true);

    const { fields } = await provider.resolve(post, match, result);
    const byName = new Map(fields.map((f) => [f.fieldName, f]));
    expect(byName.get("email")?.required).toBe(true);
    expect(byName.get("email")?.format).toBe("email");
    expect(byName.get("age")?.type).toBe("integer");
    expect(byName.get("role")?.enumValues).toEqual(["admin", "user", "guest"]);
  });

  test("el provider resuelve el schema de app.route", async () => {
    const project = await createTempProject({
      "package.json": '{"name":"mini","dependencies":{"fastify":"^4.26.0"}}',
      "server.js": [
        'import Fastify from "fastify";',
        'const app = Fastify();',
        'app.route({ method: "POST", url: "/users", schema: { body: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } } }, handler: async () => ({}) });',
      ].join("\n"),
    });
    try {
      const detector = new FastifyProjectScanner();
      const match = await detector.resolve(project.root);
      const scanner = new FastifyRouteScanner();
      const result = await scanner.scan(match);
      const routes = result.routes;
      const route = routes.find((item) => item.method === "POST" && item.uri === "/users")!;
      const provider = new FastifySchemaProvider();
      expect(await provider.supports(route, match, result)).toBe(true);
      expect((await provider.resolve(route, match, result)).fields[0]?.required).toBe(true);
    } finally {
      await project.cleanup();
    }
  });

  test("una ruta sin esquema no lo finge", async () => {
    const { match, result, routes } = await scanFixture();
    const provider = new FastifySchemaProvider();
    const health = routes.find((r) => r.uri === "/api/health")!;
    expect(await provider.supports(health, match, result)).toBe(false);
  });
});

describe("parseFastifySchema", () => {
  test("distingue body, querystring, params y headers", () => {
    const fields = parseFastifySchema(`{
      body: { type: "object", required: ["a"], properties: { a: { type: "string" } } },
      querystring: { type: "object", properties: { page: { type: "integer" } } },
      params: { type: "object", properties: { id: { type: "string" } } },
      headers: { type: "object", properties: { "x-token": { type: "string" } } }
    }`);
    const byName = new Map(fields.map((f) => [f.fieldName, f.location]));
    expect(byName.get("a")).toBe("body");
    expect(byName.get("page")).toBe("query");
    expect(byName.get("id")).toBe("path");
    expect(byName.get("x-token")).toBe("header");
  });

  test("`required` marca solo lo que está en la lista", () => {
    const fields = parseFastifySchema(`{
      body: { required: ["obligatorio"], properties: {
        obligatorio: { type: "string" }, opcional: { type: "string" }
      } }
    }`);
    const byName = new Map(fields.map((f) => [f.fieldName, f.required]));
    expect(byName.get("obligatorio")).toBe(true);
    expect(byName.get("opcional")).toBe(false);
  });

  test("un esquema vacío no inventa campos", () => {
    expect(parseFastifySchema("{}")).toEqual([]);
  });

  // Un objeto anidado tiene sus propias llaves: si el recorrido no las
  // equilibra, se come el campo siguiente.
  test("un objeto anidado no se lleva por delante al siguiente campo", () => {
    const fields = parseFastifySchema(`{
      body: { properties: {
        direccion: { type: "object", properties: { calle: { type: "string" } } },
        despues: { type: "string" }
      } }
    }`);
    expect(fields.map((f) => f.fieldName)).toContain("despues");
  });
});

// ---------------------------------------------------------------------------
// f00011 S4 — lockfiles como bonus de scoring en detect().
// ---------------------------------------------------------------------------

describe("Fastify — lockfiles como bonus de runtime (f00011 S4)", () => {
  // f00011 S4: `pnpm-lock.yaml` y `bun.lockb` afinan la confianza
  // del detector sin ser detección. Pesos pequeños: +0.1 (pnpm),
  // +0.15 (bun). El detector de Fastify suele estar al tope (1.0 con
  // `fastify` directo), así que el bonus aparece en `evidence`
  // aunque no cambie el score visible — exactamente lo que se busca
  // con esta propuesta: trazabilidad, no detección.
  test("pnpm-lock.yaml añade evidencia con peso 0.1", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { fastify: "^4.0.0" } }),
      "pnpm-lock.yaml": "",
    });
    try {
      const result = await new FastifyProjectScanner().detect(project.root);
      const pnpm = result.evidence.find((e) => e.artifact === "pnpm-lock.yaml");
      expect(pnpm).toBeDefined();
      expect(pnpm?.weight).toBe(0.1);
    } finally {
      await project.cleanup();
    }
  });

  test("bun.lockb añade evidencia con peso 0.15", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { fastify: "^4.0.0" } }),
      "bun.lockb": "",
    });
    try {
      const result = await new FastifyProjectScanner().detect(project.root);
      const bun = result.evidence.find((e) => e.artifact === "bun.lockb");
      expect(bun).toBeDefined();
      expect(bun?.weight).toBe(0.15);
    } finally {
      await project.cleanup();
    }
  });

  test("pnpm-lock.yaml + bun.lockb suman ambas señales", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { fastify: "^4.0.0" } }),
      "pnpm-lock.yaml": "",
      "bun.lockb": "",
    });
    try {
      const result = await new FastifyProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(true);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(true);
    } finally {
      await project.cleanup();
    }
  });

  test("sin lockfiles no aparece ninguna señal de lockfile", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { fastify: "^4.0.0" } }),
    });
    try {
      const result = await new FastifyProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(false);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(false);
    } finally {
      await project.cleanup();
    }
  });
});
