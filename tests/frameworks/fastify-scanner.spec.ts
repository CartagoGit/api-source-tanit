/**
 * Fastify scanner.
 *
 * Fastify is the best Node case of them all: it carries the schema
 * **inside** the route declaration, and it is JSON Schema, so it
 * gives exact types instead of inferred ones. That must be taken
 * advantage of, and these tests pin down that it is.
 *
 * Before this scanner existed, a Fastify project was picked up by
 * the Express one, which recognized it by syntax similarity and
 * dropped the schemas entirely.
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

/** Scans the full fixture with a fresh instance. */
async function scanFixture() {
  const detector = new FastifyProjectScanner();
  const match = await detector.resolve(FIXTURE);
  const scanner = new FastifyRouteScanner();
  const result = await scanner.scan(match);
  return { match, scanner, result, routes: result.routes };
}

describe("detection", () => {
  test("a project with `fastify` scores 1", async () => {
    expect((await new FastifyProjectScanner().detect(FIXTURE)).score).toBe(1);
  });

  test("a project without fastify scores 0", async () => {
    expect(
      (await new FastifyProjectScanner().detect(comprehensiveFixtureDir("django"))).score,
    ).toBe(0);
  });
});

describe("the three ways of declaring a route", () => {
  test("the short one: app.get('/x')", async () => {
    const { routes } = await scanFixture();
    expect(routes.some((r) => r.method === "GET" && r.uri === "/api/health")).toBe(true);
  });

  test("the long one: app.route({ method, url })", async () => {
    const { routes } = await scanFixture();
    expect(routes.some((r) => r.method === "POST" && r.uri === "/api/auth/login")).toBe(
      true,
    );
  });

  // `method: ["GET", "HEAD"]` is a single declaration and two endpoints.
  test("the long one with several methods yields one endpoint per method", async () => {
    const { routes } = await scanFixture();
    const status = routes.filter((r) => r.uri === "/api/status");
    expect(status.map((r) => r.method).sort()).toEqual(["GET", "HEAD"]);
  });

  test("the `register` prefix is applied to all of them", async () => {
    const { routes } = await scanFixture();
    expect(routes.every((r) => r.uri.startsWith("/api/"))).toBe(true);
  });

  test("no route is repeated", async () => {
    const { routes } = await scanFixture();
    const keys = routes.map((r) => `${r.method} ${r.uri}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("JSON Schemas from the route itself", () => {
  test("the provider resolves the route that declares body", async () => {
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

  test("the provider resolves the schema from app.route", async () => {
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

  test("a route without a schema does not fake one", async () => {
    const { match, result, routes } = await scanFixture();
    const provider = new FastifySchemaProvider();
    const health = routes.find((r) => r.uri === "/api/health")!;
    expect(await provider.supports(health, match, result)).toBe(false);
  });
});

describe("parseFastifySchema", () => {
  test("distinguishes body, querystring, params and headers", () => {
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

  test("`required` only flags what is in the list", () => {
    const fields = parseFastifySchema(`{
      body: { required: ["obligatorio"], properties: {
        obligatorio: { type: "string" }, opcional: { type: "string" }
      } }
    }`);
    const byName = new Map(fields.map((f) => [f.fieldName, f.required]));
    expect(byName.get("obligatorio")).toBe(true);
    expect(byName.get("opcional")).toBe(false);
  });

  test("an empty schema does not invent fields", () => {
    expect(parseFastifySchema("{}")).toEqual([]);
  });

  // A nested object has its own braces: if traversal does not
  // balance them, it eats the next field.
  test("a nested object does not sweep the next field with it", () => {
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
// f00011 S4 — lockfiles as scoring bonuses in detect().
// ---------------------------------------------------------------------------

describe("Fastify — lockfiles como bonus de runtime (f00011 S4)", () => {
  // f00011 S4: `pnpm-lock.yaml` and `bun.lockb` sharpen the
  // detector's confidence without being detection. Small weights:
  // +0.1 (pnpm), +0.15 (bun). The Fastify detector usually sits at
  // the cap (1.0 with `fastify` directly), so the bonus shows up in
  // `evidence` even though it does not change the visible score —
  // exactly what this proposal aims for: traceability, not detection.
  test("pnpm-lock.yaml adds evidence with weight 0.1", async () => {
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

  test("bun.lockb adds evidence with weight 0.15", async () => {
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

  test("pnpm-lock.yaml + bun.lockb add both signals", async () => {
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

  test("without lockfiles no lockfile signal appears", async () => {
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

describe("Fastify — bun.lock (texto, Bun ≥ 1.2) detection (x00035)", () => {
  // x00035 S2: idempotente con express.spec — ver rationale allí.
  test("bun.lock (text) adds evidence with weight 0.15", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { fastify: "^4.0.0" } }),
      "bun.lock": "",
    });
    try {
      const result = await new FastifyProjectScanner().detect(project.root);
      const bun = result.evidence.find((e) => e.artifact === "bun.lock");
      expect(bun).toBeDefined();
      expect(bun?.weight).toBe(0.15);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(false);
    } finally {
      await project.cleanup();
    }
  });

  test("when both bun.lock and bun.lockb exist, bun.lock wins and bun.lockb is ignored", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { fastify: "^4.0.0" } }),
      "bun.lock": "",
      "bun.lockb": "",
    });
    try {
      const result = await new FastifyProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "bun.lock")).toBe(true);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(false);
    } finally {
      await project.cleanup();
    }
  });
});
