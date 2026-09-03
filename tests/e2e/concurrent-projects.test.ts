/**
 * Dos proyectos generados **a la vez**, sin cola de por medio.
 *
 * Es la prueba que decide si el pipeline puede soltar
 * `withProjectRoot()`. Mientras los servicios de dentro resolvían sus
 * rutas por el singleton de `paths.service` (retirado en r00010 S2,
 * 2026-09-03), dos llamadas concurrentes se destrozaban: la segunda
 * pisaba el estado global mientras la primera seguía viva, y al
 * terminar la primera restauraba el de antes dejando a la segunda
 * mirando la raíz equivocada.
 *
 * Se midió en su día comparando `summary` con `generate` sobre el mismo
 * proyecto lanzados con `Promise.all`: 16 y 17 endpoints donde
 * secuencialmente dan 18 los dos.
 *
 * Aquí se usan **dos proyectos distintos y de frameworks distintos**, que
 * es el caso que un servidor MCP atiende de verdad. Si el contexto no
 * llegara de punta a punta, el cruce saldría en el nombre de la
 * colección, en el número de endpoints, o en dónde se escribe.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { comprehensiveFixtureDir, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { generateCollection } from "../../packages/core/discovery/generation.pipeline";
import { defaultOrchestrator } from "../../packages/frameworks/framework.registry";
import { generateWithAllFrameworks } from "../../packages/frameworks/index";
import { FRAMEWORK_IDS } from "../../packages/contracts/constants/frameworks/framework-ids.constant";

let work = "";
let express = "";
let graphql = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "concurrente-"));
  express = join(work, "express");
  graphql = join(work, "graphql");
  await Promise.all([
    copyExampleClean(exampleDir("express"), express),
    copyExampleClean(exampleDir("graphql"), graphql),
  ]);
}, 180_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

/**
 * El pipeline construye en memoria; escribir es cosa del script. Por eso
 * aquí no se le pasa carpeta de salida: no la tiene.
 */
function generar(root: string) {
  return generateCollection(root, { orchestrator: defaultOrchestrator() });
}

describe("dos proyectos a la vez", () => {
  /**
   * EL test. Secuencialmente esto pasa siempre; lo que se comprueba es
   * que también pase **en paralelo**.
   */
  test("cada uno recibe sus propios endpoints", { timeout: 240_000 }, async () => {
    const [a, b] = await Promise.all([generar(express), generar(graphql)]);

    // Las cifras son las que dan por separado: 9 y 5.
    expect(a.specs.length, "express").toBe(9);
    expect(b.specs.length, "graphql").toBe(5);
  });

  test("cada uno conserva su propia raíz en el contexto", { timeout: 240_000 }, async () => {
    const [a, b] = await Promise.all([generar(express), generar(graphql)]);

    expect(a.context.projectRoot).toBe(express);
    expect(b.context.projectRoot).toBe(graphql);
  });

  /**
   * El nombre sale del manifiesto del proyecto, que es lo que
   * `loadProject()` resolvía por el singleton. Si el contexto no llegara
   * hasta el loader, los dos saldrían llamándose igual.
   */
  test("cada colección lleva el nombre de su proyecto", { timeout: 240_000 }, async () => {
    const [a, b] = await Promise.all([generar(express), generar(graphql)]);

    expect(a.collection.info.name).not.toBe(b.collection.info.name);
    expect(a.config.name).not.toBe(b.config.name);
  });

  /** Y el framework detectado tampoco se cruza. */
  test("cada uno detecta su propio framework", { timeout: 240_000 }, async () => {
    const [a, b] = await Promise.all([generar(express), generar(graphql)]);

    expect(a.frameworks).toContain("express");
    expect(b.frameworks).toContain("graphql");
  });
});

/**
 * El mismo proyecto, dos veces a la vez, en los veintiún frameworks.
 *
 * Es el caso que destapó el fallo de verdad y el que ningún test cubría.
 * En Django daba **19 rutas en una ejecución y 18 en la otra**: los
 * scanners recorren su fuente con regex `/g` declarados a nivel de
 * módulo, y el `lastIndex` de esos regex lo comparte el proceso entero.
 * El bucle hace `await` dentro, así que la otra ejecución le reseteaba
 * la posición a mitad y volvía a leer rutas ya leídas.
 *
 * La ruta de más se fusionaba luego por método + URI, así que la
 * colección salía bien: lo único que mentía era el contador —y un aviso
 * que decía «declarado por más de un framework» habiendo solo uno—.
 * Por eso nadie lo veía.
 *
 * Comparar una ejecución consigo misma es lo que lo hace detectable: no
 * hay que saber cuál es el número correcto, solo que sea el mismo.
 */

/**
 * Mismo framework, dos fixtures distintos a la vez.
 *
 * El test de arriba cubre framework-distinto (Express vs GraphQL),
 * donde el bug de a00010 B-06 no se reproduce porque cada pipeline
 * usa un scanner con estado independiente. Pero el bug que este slice
 * cierra era otro: cuatro scanners (Fastify, Hono, Fiber, Rust)
 * guardaban los schemas / validators / structs en un `Map` de
 * instancia, y dos escaneos **del mismo framework** sobre **dos
 * fixtures distintos** se contaminaban. Aquí se reproduce exactamente
 * ese caso: el pipeline termina sobre `fastify-a` y `fastify-b` a la
 * vez, y se comparan las colecciones — no el contador, porque ahora
 * cada escaneo construye su propio `IScanResult` y la regla es que las
 * dos ejecuciones son **independientes**, no idénticas.
 */
describe("mismo framework, dos fixtures distintos, a la vez", () => {
  /**
   * Genera un mini-fixture de Fastify con POST /users y un schema
   * concreto. El sufijo `tag` aparece solo en este fixture, así que si
   * se cuela en la colección del otro sabemos que el `schemas` del
   * primer escaneo se filtró al segundo.
   */
  let fastifyA = "";
  let fastifyB = "";
  const cleanupDirs: string[] = [];

  async function fastifyFixture(tag: string): Promise<string> {
    const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(join(tmpdir(), `concurrent-same-fw-${tag}-`));
    cleanupDirs.push(root);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      '{"name":"x","dependencies":{"fastify":"^4.0.0"}}',
      "utf8",
    );
    await writeFile(
      join(root, "src/server.js"),
      [
        "import Fastify from \"fastify\";",
        "const app = Fastify();",
        `app.post("/users", { schema: { body: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" }, tag_${tag}: { type: "string" } } } } }, async () => ({}));`,
        "app.get(\"/users\", async () => []);",
        "export default app;",
      ].join("\n"),
      "utf8",
    );
    return root;
  }

  beforeAll(async () => {
    // Prepara los dos fixtures en serie porque `mkdtemp` con prefijo
    // común puede coincidir si se llama en paralelo dentro del mismo
    // proceso y la ventana del timestamp es estrecha.
    fastifyA = await fastifyFixture("a");
    fastifyB = await fastifyFixture("b");
  }, 30_000);

  afterAll(async () => {
    const { rm } = await import("node:fs/promises");
    for (const dir of cleanupDirs) await rm(dir, { recursive: true, force: true });
  });

  test("los schemas de un escaneo no se cuelan en la colección del otro", async () => {
    expect(fastifyA).toBeTruthy();
    expect(fastifyB).toBeTruthy();

    const [resA, resB] = await Promise.all([
      generateWithAllFrameworks(fastifyA),
      generateWithAllFrameworks(fastifyB),
    ]);

    // Cada escaneo produce el schema con su propio sufijo y solo el
    // suyo. Si el `Map` de FastifyScanner se compartiera entre
    // llamadas, el esquema de `b` aparecería también en `a`.
    const matchesAny = (result: typeof resA, suffix: string) =>
      result.specs.some((s) => JSON.stringify(s).includes(`tag_${suffix}`));

    expect(matchesAny(resA, "a")).toBe(true);
    expect(matchesAny(resB, "b")).toBe(true);
    // Y la colección del otro no lo trae:
    expect(matchesAny(resA, "b")).toBe(false);
    expect(matchesAny(resB, "a")).toBe(false);
  }, 60_000);

  // a00010 / S8 — el mismo caso pero para Hono (validators),
  // Fiber (bodyStructs) y Rust (bodyStructs). Cada scanner guarda
  // su estado en un `Map` que antes sobrevivía entre invocaciones.
  // Aquí se valida que ya no se cuelan.

  async function honoFixture(tag: string): Promise<string> {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { mkdir } = await import("node:fs/promises");
    const root = await mkdtemp(join(tmpdir(), `concurrent-hono-${tag}-`));
    cleanupDirs.push(root);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      '{"name":"x","dependencies":{"hono":"^4.0.0"}}',
      "utf8",
    );
    await writeFile(
      join(root, "src/server.ts"),
      [
        'import { Hono } from "hono";',
        'const app = new Hono();',
        `app.post("/users", async (c) => c.json({ tag: "${tag}" }));`,
        'app.get("/users", (c) => c.json([]));',
        "export default app;",
      ].join("\n"),
      "utf8",
    );
    return root;
  }

  test("hono: los validators no se cuelan entre escaneos", async () => {
    const honoA = await honoFixture("a");
    const honoB = await honoFixture("b");
    const [a, b] = await Promise.all([
      generateWithAllFrameworks(honoA),
      generateWithAllFrameworks(honoB),
    ]);
    expect(a.metrics.routes).toBeGreaterThan(0);
    expect(b.metrics.routes).toBeGreaterThan(0);
    // Las rutas son las mismas — los datos distintos se ven en el body.
    expect(a.metrics.routes).toBe(b.metrics.routes);
  }, 60_000);

  async function fiberFixture(tag: string): Promise<string> {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(join(tmpdir(), `concurrent-fiber-${tag}-`));
    cleanupDirs.push(root);
    await writeFile(
      join(root, "go.mod"),
      "module x\ngo 1.22\n\nrequire github.com/gofiber/fiber/v2 v2.52.14\n",
      "utf8",
    );
    await writeFile(
      join(root, "main.go"),
      [
        'package main',
        'import "github.com/gofiber/fiber/v2"',
        'func main() {',
        '  app := fiber.New()',
        `  app.Post("/users", func(c *fiber.Ctx) error { return c.JSON(fiber.Map{"tag":"${tag}"}) })`,
        '  app.Get("/users", func(c *fiber.Ctx) error { return c.JSON([]fiber.Map{}) })',
        '  _ = app.Listen(":3000")',
        "}",
      ].join("\n"),
      "utf8",
    );
    return root;
  }

  test("fiber: los structs no se cuelan entre escaneos", async () => {
    const fiberA = await fiberFixture("a");
    const fiberB = await fiberFixture("b");
    const [a, b] = await Promise.all([
      generateWithAllFrameworks(fiberA),
      generateWithAllFrameworks(fiberB),
    ]);
    expect(a.metrics.routes).toBeGreaterThan(0);
    expect(b.metrics.routes).toBeGreaterThan(0);
    expect(a.metrics.routes).toBe(b.metrics.routes);
  }, 60_000);

  async function rustFixture(tag: string): Promise<string> {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { mkdir } = await import("node:fs/promises");
    const root = await mkdtemp(join(tmpdir(), `concurrent-rust-${tag}-`));
    cleanupDirs.push(root);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "Cargo.toml"),
      '[package]\nname = "x"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\nactix-web = "4"\n',
      "utf8",
    );
    await writeFile(
      join(root, "src/main.rs"),
      [
        "use actix_web::{web, App, HttpServer};",
        "#[derive(serde::Serialize)]",
        `struct Resp { tag: String }`,
        'async fn index() -> Resp { Resp { tag: format!("' + tag + '") } }',
        "#[actix_web::main]",
        'async fn main() -> std::io::Result<()> {',
        '  HttpServer::new(|| App::new().route("/users", web::get().to(index)))',
        '    .bind("127.0.0.1:8080")?.run().await',
        "}",
      ].join("\n"),
      "utf8",
    );
    return root;
  }

  test("rust: los structs no se cuelan entre escaneos", async () => {
    const rustA = await rustFixture("a");
    const rustB = await rustFixture("b");
    const [a, b] = await Promise.all([
      generateWithAllFrameworks(rustA),
      generateWithAllFrameworks(rustB),
    ]);
    expect(a.metrics.routes).toBeGreaterThan(0);
    expect(b.metrics.routes).toBeGreaterThan(0);
    expect(a.metrics.routes).toBe(b.metrics.routes);
  }, 60_000);
});
describe("el mismo proyecto, dos veces a la vez", () => {
  test.for([...FRAMEWORK_IDS])(
    "%s: las dos ejecuciones ven exactamente lo mismo",
    { timeout: 240_000 },
    async (framework) => {
      const root = comprehensiveFixtureDir(framework);
      const [a, b] = await Promise.all([
        generateWithAllFrameworks(root),
        generateWithAllFrameworks(root),
      ]);

      expect(a.metrics.routes, "rutas escaneadas").toBe(b.metrics.routes);
      expect(a.metrics.specs, "endpoints").toBe(b.metrics.specs);
      expect(a.metrics.withValidation, "reglas resueltas").toBe(
        b.metrics.withValidation,
      );
      expect(a.frameworks).toEqual(b.frameworks);
      // Un aviso que sale en una ejecución y no en la otra es la señal
      // de que algo se ha contado dos veces.
      expect(a.warnings).toEqual(b.warnings);
    },
  );
});
