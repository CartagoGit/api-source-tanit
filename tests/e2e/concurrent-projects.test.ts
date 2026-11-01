/**
 * Two projects generated **at the same time**, with no queue in between.
 *
 * This is the test that decides whether the pipeline can drop
 * `withProjectRoot()`. While the inner services resolved their paths via
 * the `paths.service` singleton (removed in r00010 S2, 2026-09-03),
 * two concurrent calls tore each other apart: the second overwrote the
 * global state while the first was still running, and when the first
 * finished it restored the previous state, leaving the second looking
 * at the wrong root.
 *
 * It was once measured by comparing `summary` with `generate` on the
 * same project launched with `Promise.all`: 16 and 17 endpoints where
 * sequentially both return 18.
 *
 * Here we use **two distinct projects of distinct frameworks**, which is
 * the case an MCP server actually serves. If the context did not travel
 * end-to-end, the cross-pollination would show up in the collection
 * name, in the endpoint count, or in the write target.
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
 * The pipeline builds in memory; writing is the script's job. That is why
 * no output folder is passed in here: it has none.
 */
function generar(root: string) {
  return generateCollection(root, { orchestrator: defaultOrchestrator() });
}

describe("two projects at once", () => {
  /**
   * THE test. Sequentially this always passes; what is being checked is
   * that it also passes **in parallel**.
   */
  test("each one gets its own endpoints", { timeout: 240_000 }, async () => {
    const [a, b] = await Promise.all([generar(express), generar(graphql)]);

    // The figures are what each gives on its own: 9 and 5.
    expect(a.specs.length, "express").toBe(9);
    expect(b.specs.length, "graphql").toBe(5);
  });

  test("each one keeps its own root in the context", { timeout: 240_000 }, async () => {
    const [a, b] = await Promise.all([generar(express), generar(graphql)]);

    expect(a.context.projectRoot).toBe(express);
    expect(b.context.projectRoot).toBe(graphql);
  });

  /**
   * The name comes from the project's manifest, which is what
   * `loadProject()` was resolving through the singleton. If the context
   * did not reach the loader, the two would come out with the same name.
   */
  test("each collection carries the name of its project", { timeout: 240_000 }, async () => {
    const [a, b] = await Promise.all([generar(express), generar(graphql)]);

    expect(a.collection.info.name).not.toBe(b.collection.info.name);
    expect(a.config.name).not.toBe(b.config.name);
  });

  /** And the detected framework does not cross-pollinate either. */
  test("each one detects its own framework", { timeout: 240_000 }, async () => {
    const [a, b] = await Promise.all([generar(express), generar(graphql)]);

    expect(a.frameworks).toContain("express");
    expect(b.frameworks).toContain("graphql");
  });
});

/**
 * The same project, twice at the same time, across all twenty-one frameworks.
 *
 * This is the case that uncovered the real failure, and the one no test
 * covered. In Django it gave **19 routes in one run and 18 in the
 * other**: scanners walk their source with `/g` regexes declared at
 * module level, and the `lastIndex` of those regexes is shared by the
 * whole process. The loop awaits inside, so the other run would reset
 * its position halfway and re-read routes it had already read.
 *
 * The extra route was then merged by method + URI, so the collection
 * came out fine: the only thing lying was the counter — and a warning
 * saying "declared by more than one framework" when there was only one.
 * That is why nobody saw it.
 *
 * Comparing a run with itself is what makes it detectable: no need to
 * know the correct number, just that it is the same.
 */

/**
 * Same framework, two distinct fixtures at once.
 *
 * The test above covers distinct frameworks (Express vs GraphQL), where
 * the a00010 B-06 bug does not reproduce because each pipeline uses a
 * scanner with independent state. But the bug this slice closes was a
 * different one: four scanners (Fastify, Hono, Fiber, Rust) kept their
 * schemas / validators / structs in an instance `Map`, and two scans
 * **of the same framework** on **two different fixtures** contaminated
 * each other. Here we reproduce exactly that case: the pipeline ends on
 * `fastify-a` and `fastify-b` at the same time, and the collections are
 * compared — not the counter, because now each scan builds its own
 * `IScanResult` and the rule is that the two runs are **independent**,
 * not identical.
 */
describe("same framework, two distinct fixtures, at once", () => {
  /**
   * Generates a mini Fastify fixture with POST /users and a specific
   * schema. The `tag` suffix appears only in this fixture, so if it
   * leaks into the other's collection we know the `schemas` of the
   * first scan leaked into the second.
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
    // Prepare the two fixtures in series because `mkdtemp` with a
    // common prefix can collide if called in parallel within the same
    // process and the timestamp window is narrow.
    fastifyA = await fastifyFixture("a");
    fastifyB = await fastifyFixture("b");
  }, 30_000);

  afterAll(async () => {
    const { rm } = await import("node:fs/promises");
    for (const dir of cleanupDirs) await rm(dir, { recursive: true, force: true });
  });

  test("schemas from one scan do not leak into the other's collection", async () => {
    expect(fastifyA).toBeTruthy();
    expect(fastifyB).toBeTruthy();

    const [resA, resB] = await Promise.all([
      generateWithAllFrameworks(fastifyA),
      generateWithAllFrameworks(fastifyB),
    ]);

    // Each scan produces the schema with its own suffix and only its
    // own. If FastifyScanner's `Map` were shared between calls, the `b`
    // schema would also appear in `a`.
    const matchesAny = (result: typeof resA, suffix: string) =>
      result.specs.some((s) => JSON.stringify(s).includes(`tag_${suffix}`));

    expect(matchesAny(resA, "a")).toBe(true);
    expect(matchesAny(resB, "b")).toBe(true);
    // And the other's collection does not carry it:
    expect(matchesAny(resA, "b")).toBe(false);
    expect(matchesAny(resB, "a")).toBe(false);
  }, 60_000);

  // a00010 / S8 — the same case but for Hono (validators),
  // Fiber (bodyStructs), and Rust (bodyStructs). Each scanner keeps
  // its state in a `Map` that previously survived between invocations.
  // This validates that they no longer leak.

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
        'import { z } from "zod";',
        'import { zValidator } from "@hono/zod-validator";',
        'const app = new Hono();',
        `const RequestSchema = z.object({ exclusive_${tag}: z.string() });`,
        `app.post("/users", zValidator("json", RequestSchema), async (c) => c.json({ tag: "${tag}" }));`,
        'app.get("/users", (c) => c.json([]));',
        "export default app;",
      ].join("\n"),
      "utf8",
    );
    return root;
  }

  test("hono: validators do not leak between scans", async () => {
    const honoA = await honoFixture("a");
    const honoB = await honoFixture("b");
    const [a, b] = await Promise.all([
      generateWithAllFrameworks(honoA),
      generateWithAllFrameworks(honoB),
    ]);
    const serializedA = JSON.stringify(a.specs);
    const serializedB = JSON.stringify(b.specs);
    expect(serializedA).toContain("exclusive_a");
    expect(serializedB).toContain("exclusive_b");
    expect(serializedA).not.toContain("exclusive_b");
    expect(serializedB).not.toContain("exclusive_a");
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
        `type Create${tag} struct { Exclusive${tag} string \`json:"exclusive_${tag}" validate:"required"\` }`,
        'func main() {',
        '  app := fiber.New()',
        `  app.Post("/users", func(c *fiber.Ctx) error { var body Create${tag}; if err := c.BodyParser(&body); err != nil { return err }; return c.JSON(body) })`,
        '  app.Get("/users", func(c *fiber.Ctx) error { return c.JSON([]fiber.Map{}) })',
        '  _ = app.Listen(":3000")',
        "}",
      ].join("\n"),
      "utf8",
    );
    return root;
  }

  test("fiber: structs do not leak between scans", async () => {
    const fiberA = await fiberFixture("a");
    const fiberB = await fiberFixture("b");
    const [a, b] = await Promise.all([
      generateWithAllFrameworks(fiberA),
      generateWithAllFrameworks(fiberB),
    ]);
    const serializedA = JSON.stringify(a.specs);
    const serializedB = JSON.stringify(b.specs);
    expect(serializedA).toContain("exclusive_a");
    expect(serializedB).toContain("exclusive_b");
    expect(serializedA).not.toContain("exclusive_b");
    expect(serializedB).not.toContain("exclusive_a");
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
        "use serde::Deserialize;",
        "#[derive(Deserialize)]",
        `struct Create${tag} { exclusive_${tag}: String }`,
        `#[post("/users")]`,
        `async fn index(_body: web::Json<Create${tag}>) -> String { "ok".to_string() }`,
        "#[actix_web::main]",
        'async fn main() -> std::io::Result<()> {',
        '  HttpServer::new(|| App::new().service(index))',
        '    .bind("127.0.0.1:8080")?.run().await',
        "}",
      ].join("\n"),
      "utf8",
    );
    return root;
  }

  test("rust: structs do not leak between scans", async () => {
    const rustA = await rustFixture("a");
    const rustB = await rustFixture("b");
    const [a, b] = await Promise.all([
      generateWithAllFrameworks(rustA),
      generateWithAllFrameworks(rustB),
    ]);
    const serializedA = JSON.stringify(a.specs);
    const serializedB = JSON.stringify(b.specs);
    expect(serializedA).toContain("exclusive_a");
    expect(serializedB).toContain("exclusive_b");
    expect(serializedA).not.toContain("exclusive_b");
    expect(serializedB).not.toContain("exclusive_a");
  }, 60_000);
});
describe("the same project, twice at once", () => {
  test.for([...FRAMEWORK_IDS])(
    "%s: both runs see exactly the same",
    { timeout: 240_000 },
    async (framework) => {
      const root = comprehensiveFixtureDir(framework);
      const [a, b] = await Promise.all([
        generateWithAllFrameworks(root),
        generateWithAllFrameworks(root),
      ]);

      expect(a.metrics.routes, "scanned routes").toBe(b.metrics.routes);
      expect(a.metrics.specs, "endpoints").toBe(b.metrics.specs);
      expect(a.metrics.withValidation, "resolved rules").toBe(
        b.metrics.withValidation,
      );
      expect(a.frameworks).toEqual(b.frameworks);
      // A warning that appears in one run and not in the other is the
      // signal that something has been counted twice.
      expect(a.warnings).toEqual(b.warnings);
    },
  );
});
