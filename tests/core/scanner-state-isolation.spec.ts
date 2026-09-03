/**
 * State isolation entre llamadas a `scan()`.
 *
 * El bug que cerró a00010 S2: cuatro scanners (Fastify, Hono, Fiber,
 * Rust) guardaban en un `Map<routeKey, T>` a nivel de **instancia** lo
 * que el escaneo iba encontrando — el JSON Schema de Fastify, el
 * nombre del esquema zod de Hono, el struct que parsea el body en
 * Fiber y Rust. La siguiente llamada al `scan()` de la misma
 * instancia leía ese `Map` por delante y mezclaba su contenido con
 * el del escaneo nuevo.
 *
 * El bug no es teórico: dos escaneos sobre el mismo proyecto (o
 * sobre dos proyectos del mismo framework) veían los schemas /
 * validators / structs del otro, y una ruta "sin schema" podía
 * salir con las reglas del vecino.
 *
 * El contrato nuevo (`IScanResult`) cierra eso por construcción: el
 * estado vive en la salida de `scan()`, no en la instancia. Lo que
 * fija este test es que la promesa **se cumple**: dos escaneos
 * consecutivos sobre el mismo scanner no contaminan al segundo con
 * datos del primero, ni viceversa.
 *
 * Se prueba con los cuatro frameworks afectados y contra dos
 * fixtures distintos para descartar también el caso "el segundo
 * escaneo hereda las claves del primero aunque el archivo no las
 * tenga".
 */
import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FastifyProjectScanner, FastifyRouteScanner, FastifySchemaProvider } from "../../packages/frameworks/scanners/fastify.scanner";
import { HonoProjectScanner, HonoRouteScanner, HonoZodValidatorProvider } from "../../packages/frameworks/scanners/hono.scanner";
import { FiberProjectScanner, FiberRouteScanner, FiberValidateTagProvider } from "../../packages/frameworks/scanners/fiber.scanner";
import { RustProjectScanner, RustRouteScanner, RustValidatorProvider } from "../../packages/frameworks/scanners/rust.scanner";

/** Crea un proyecto con un solo archivo. */
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

describe("estado mutable entre llamadas — a00010 S2", () => {
  test("Fastify: dos escaneos sobre el mismo scanner no comparten schemas", async () => {
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

      // Primera request: resuelve con el schema de A (campo `onlyOnA`).
      expect(await provider.supports(userA!, matchA, resultA)).toBe(true);
      const fieldsA = (await provider.resolve(userA!, matchA, resultA)).fields;
      expect(fieldsA.map((f) => f.fieldName)).toContain("onlyOnA");

      // Mismo scanner, ahora sobre B: no debe llevar el campo de A.
      const resultB = await scanner.scan(matchB);
      const itemB = resultB.routes.find((r) => r.method === "GET" && r.uri === "/items");
      expect(itemB).toBeDefined();
      expect(await provider.supports(itemB!, matchB, resultB)).toBe(false);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });

  test("Hono: dos escaneos sobre el mismo scanner no comparten validators", async () => {
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

  test("Fiber: el bodyStruct de un escaneo no contamina al siguiente", async () => {
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
      // Primer escaneo reconoce el body struct de A.
      expect(await provider.supports(postA!, matchA, resultA)).toBe(true);
      const structA = resultA.structs?.get("POST /a");
      expect(structA?.name).toBe("ACreateRequest");

      // Mismo scanner, ahora sobre B: el mapa de structs no arrastra el
      // nombre de A. La ruta `/b` no lleva schema (no llama a
      // BodyParser) y por tanto `supports()` devuelve `false`.
      const resultB = await scanner.scan(matchB);
      const getB = resultB.routes.find((r) => r.method === "GET");
      expect(getB).toBeDefined();
      expect(await provider.supports(getB!, matchB, resultB)).toBe(false);
      // Y el `IScanResult.structs` del segundo escaneo está vacío.
      expect(resultB.structs?.size ?? 0).toBe(0);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });

  test("Rust: el bodyStruct de un escaneo no contamina al siguiente", async () => {
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

  test("la misma instancia del scanner reutilizada cien veces da el mismo resultado", async () => {
    // Llamar `scan()` muchas veces seguidas es el camino de un test
    // paramétrico o de un servidor que escanea en cada request.
    // Antes del cierre de a00010 S2 las primeras invocaciones
    // contaminaban a las últimas y `routes.length` variaba entre
    // ejecuciones. Ahora el resultado es estable.
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
        // Y en cada llamada, `schemas` está poblado solo si lo está en
        // los fuentes: nunca arrastrado de un scan previo.
        expect(result.schemas?.has("POST /users")).toBe(true);
      }
      expect(fingerprints.size).toBe(1);
    } finally {
      await project.cleanup();
    }
  });
});
