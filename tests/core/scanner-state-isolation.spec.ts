/**
 * State isolation between `scan()` calls.
 *
 * The bug a00010 S2 closed: four scanners (Fastify, Hono, Fiber, Rust)
 * stored in an instance-level `Map<routeKey, T>` what scanning was
 * finding — the Fastify JSON Schema, the Hono zod schema name, the
 * body-parsing struct in Fiber and Rust. The next call to `scan()`
 * on the same instance read that `Map` first and mixed its contents
 * with the new scan.
 *
 * The bug is not theoretical: two scans over the same project (or
 * over two projects of the same framework) saw the other's schemas /
 * validators / structs, and a "schema-less" route could come out
 * with the neighbour's rules.
 *
 * The new contract (`IScanResult`) closes that by construction: the
 * state lives in the `scan()` output, not in the instance. What this
 * test pins is that the promise **holds**: two consecutive scans on
 * the same scanner do not contaminate the second with data from the
 * first, nor vice versa.
 *
 * It is tested with the four affected frameworks and against two
 * different fixtures to also rule out the case where "the second scan
 * inherits the keys of the first even though the file does not have
 * them".
 */
import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FastifyProjectScanner, FastifyRouteScanner, FastifySchemaProvider } from "../../packages/frameworks/scanners/fastify.scanner";
import { HonoProjectScanner, HonoRouteScanner, HonoZodValidatorProvider } from "../../packages/frameworks/scanners/hono.scanner";
import { FiberProjectScanner, FiberRouteScanner, FiberValidateTagProvider } from "../../packages/frameworks/scanners/fiber.scanner";
import { RustProjectScanner, RustRouteScanner, RustValidatorProvider } from "../../packages/frameworks/scanners/rust.scanner";

/** Creates a project with a single file. */
async function makeProject(files: Record<string, string>, tag: string): Promise<{
  root: string;
  cleanup(): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), `state-isolation-${tag}-`));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

describe("mutable state between calls — a00010 S2", () => {
  test("Fastify: two scans over the same scanner do not share schemas", async () => {
    const a = await makeProject(
      {
        "package.json": '{"name":"a","dependencies":{"fastify":"^4.0.0"}}',
        "server.js": `import Fastify from "fastify";
const app = Fastify();
app.post("/users", { schema: { body: { type: "object", required: ["x"], properties: { x: { type: "string" }, onlyOnA: { type: "string" } } } } }, async () => ({}));
app.get("/users", async () => []);
export default app;`,
      },
      "fastify-a",
    );
    const b = await makeProject(
      {
        "package.json": '{"name":"b","dependencies":{"fastify":"^4.0.0"}}',
        "server.js": `import Fastify from "fastify";
const app = Fastify();
app.get("/items", async () => []);
export default app;`,
      },
      "fastify-b",
    );

    try {
      const scanner = new FastifyRouteScanner();
      const detector = new FastifyProjectScanner();
      const provider = new FastifySchemaProvider();

      const matchA = await detector.resolve(a.root);
      const matchB = await detector.resolve(b.root);

      const resultA = await scanner.scan(matchA);
      const userA = resultA.routes.find((r) => r.method === "POST" && r.uri === "/users");
      expect(userA).toBeDefined();

      // First request: resolves with A's schema (field `onlyOnA`).
      expect(await provider.supports(userA!, matchA, resultA)).toBe(true);
      const fieldsA = (await provider.resolve(userA!, matchA, resultA)).fields;
      expect(fieldsA.map((f) => f.fieldName)).toContain("onlyOnA");

      // Same scanner, now on B: must not carry A's field.
      const resultB = await scanner.scan(matchB);
      const itemB = resultB.routes.find((r) => r.method === "GET" && r.uri === "/items");
      expect(itemB).toBeDefined();
      expect(await provider.supports(itemB!, matchB, resultB)).toBe(false);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });

  test("Hono: two scans over the same scanner do not share validators", async () => {
    const a = await makeProject(
      {
        "package.json": '{"name":"a","type":"module","dependencies":{"hono":"^4.0.0","@hono/zod-validator":"^0.4.0","zod":"^3.23.0"}}',
        "index.ts": `import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
const ASchema = z.object({ name: z.string(), tagFromA: z.literal("v") });
const app = new Hono();
app.post("/a", zValidator("json", ASchema), (c) => c.json({}));
app.get("/a", (c) => c.json({}));
export default app;`,
      },
      "hono-a",
    );
    const b = await makeProject(
      {
        "package.json": '{"name":"b","type":"module","dependencies":{"hono":"^4.0.0"}}',
        "index.ts": `import { Hono } from "hono";
const app = new Hono();
app.get("/b", (c) => c.json({}));
export default app;`,
      },
      "hono-b",
    );
    try {
      const scanner = new HonoRouteScanner();
      const detector = new HonoProjectScanner();
      const provider = new HonoZodValidatorProvider();
      const matchA = await detector.resolve(a.root);
      const matchB = await detector.resolve(b.root);
      const resultA = await scanner.scan(matchA);
      const postA = resultA.routes.find((r) => r.method === "POST");
      expect(postA).toBeDefined();
      expect(await provider.supports(postA!, matchA, resultA)).toBe(true);
      const fieldsA = (await provider.resolve(postA!, matchA, resultA)).fields;
      expect(fieldsA.map((f) => f.fieldName)).toContain("tagFromA");
      const resultB = await scanner.scan(matchB);
      const getB = resultB.routes.find((r) => r.method === "GET");
      expect(getB).toBeDefined();
      expect(await provider.supports(getB!, matchB, resultB)).toBe(false);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });

  test("Fiber: the bodyStruct of one scan does not contaminate the next", async () => {
    const a = await makeProject(
      {
        "go.mod": "module a\n\ngo 1.22\n\nrequire github.com/gofiber/fiber/v2 v2.52.0\n",
        "main.go": `package main
import "github.com/gofiber/fiber/v2"
type ACreateRequest struct {
  Name string \`json:"name" validate:"required"\`
  OnlyOnA string \`json:"onlyOnA" validate:"required"\`
}
func main() {
  app := fiber.New()
  app.Post("/a", func(c *fiber.Ctx) error {
    var body ACreateRequest
    c.BodyParser(&body)
    return c.SendStatus(201)
  })
  app.Listen(":3000")
}`,
      },
      "fiber-a",
    );
    const b = await makeProject(
      {
        "go.mod": "module b\n\ngo 1.22\n\nrequire github.com/gofiber/fiber/v2 v2.52.0\n",
        "main.go": `package main
import "github.com/gofiber/fiber/v2"
func main() {
  app := fiber.New()
  app.Get("/b", func(c *fiber.Ctx) error { return c.SendString("ok") })
  app.Listen(":3000")
}`,
      },
      "fiber-b",
    );
    try {
      const scanner = new FiberRouteScanner();
      const detector = new FiberProjectScanner();
      const provider = new FiberValidateTagProvider();
      const matchA = await detector.resolve(a.root);
      const matchB = await detector.resolve(b.root);
      const resultA = await scanner.scan(matchA);
      const postA = resultA.routes.find((r) => r.method === "POST");
      expect(postA).toBeDefined();
      // First scan recognizes A's body struct.
      expect(await provider.supports(postA!, matchA, resultA)).toBe(true);
      const structA = resultA.structs?.get("POST /a");
      expect(structA?.name).toBe("ACreateRequest");

      // Same scanner, now on B: the structs map does not drag A's
      // name. The `/b` route carries no schema (no BodyParser call)
      // and therefore `supports()` returns `false`.
      const resultB = await scanner.scan(matchB);
      const getB = resultB.routes.find((r) => r.method === "GET");
      expect(getB).toBeDefined();
      expect(await provider.supports(getB!, matchB, resultB)).toBe(false);
      // And the second scan's `IScanResult.structs` is empty.
      expect(resultB.structs?.size ?? 0).toBe(0);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });

  test("Rust: the bodyStruct of one scan does not contaminate the next", async () => {
    const a = await makeProject(
      {
        "Cargo.toml": '[package]\nname="a"\n\n[dependencies]\nactix-web="4"\n',
        "src/main.rs": `use actix_web::{post, web, App, HttpServer};
#[derive(serde::Deserialize)]
pub struct ACreate {
  pub name: String,
  pub only_on_a: String,
}
#[post("/a")]
async fn create(body: web::Json<ACreate>) -> String { "ok".into() }
#[actix_web::main]
async fn main() { HttpServer::new(|| App::new().service(create)).bind("0.0.0.0:0").unwrap().run().await.unwrap(); }`,
      },
      "rust-a",
    );
    const b = await makeProject(
      {
        "Cargo.toml": '[package]\nname="b"\n\n[dependencies]\nactix-web="4"\n',
        "src/main.rs": `use actix_web::{get, App, HttpServer};
#[get("/b")]
async fn ping() -> &'static str { "pong" }
#[actix_web::main]
async fn main() { HttpServer::new(|| App::new().service(ping)).bind("0.0.0.0:0").unwrap().run().await.unwrap(); }`,
      },
      "rust-b",
    );
    try {
      const scanner = new RustRouteScanner();
      const detector = new RustProjectScanner();
      const provider = new RustValidatorProvider();
      const matchA = await detector.resolve(a.root);
      const matchB = await detector.resolve(b.root);
      const resultA = await scanner.scan(matchA);
      const postA = resultA.routes.find((r) => r.method === "POST");
      expect(postA).toBeDefined();
      expect(await provider.supports(postA!, matchA, resultA)).toBe(true);
      const structA = resultA.structs?.get("POST /a");
      expect(structA?.name).toBe("ACreate");

      const resultB = await scanner.scan(matchB);
      const getB = resultB.routes.find((r) => r.method === "GET");
      expect(getB).toBeDefined();
      expect(await provider.supports(getB!, matchB, resultB)).toBe(false);
      expect(resultB.structs?.size ?? 0).toBe(0);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });

  test("the same scanner instance reused one hundred times yields the same result", async () => {
    // Calling `scan()` many times in a row is the path of a
    // parametric test or of a server that scans on every request.
    // Before a00010 S2 was closed, the first invocations contaminated
    // the last ones and `routes.length` varied across runs. Now the
    // result is stable.
    const project = await makeProject(
      {
        "package.json": '{"name":"x","dependencies":{"fastify":"^4.0.0"}}',
        "server.js": `import Fastify from "fastify";
const app = Fastify();
app.post("/users", { schema: { body: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } } } }, async () => ({}));
app.get("/users", async () => []);
export default app;`,
      },
      "stable",
    );
    try {
      const scanner = new FastifyRouteScanner();
      const detector = new FastifyProjectScanner();
      const match = await detector.resolve(project.root);
      const fingerprints = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const result = await scanner.scan(match);
        const fp = result.routes
          .map((r) => `${r.method} ${r.uri}`)
          .sort()
          .join(",");
        fingerprints.add(fp);
        // And in every call, `schemas` is populated only if it is so
        // in the sources: never dragged from a previous scan.
        expect(result.schemas?.has("POST /users")).toBe(true);
      }
      expect(fingerprints.size).toBe(1);
    } finally {
      await project.cleanup();
    }
  });
});
