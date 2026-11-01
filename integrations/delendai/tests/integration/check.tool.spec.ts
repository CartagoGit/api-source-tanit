/**
 * The `check` tool, which was the one most needed.
 *
 * It answers "has my collection drifted from the code?" — the
 * question an agent wants to ask before touching anything, and that
 * could not: the command existed in the CLI from the start and the
 * plugin did not expose it. Four tools for twelve commands.
 *
 * What we really check is that it returns **data**, not the table
 * the CLI prints: an agent that parses text with regex breaks the
 * day a column changes, and that hack has already been paid for
 * here.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildCheckToolRegistration } from "../../src/lib/tools/check.tool";
import { captureHandler, makeContext, workspaceRoot } from "../helpers/plugin-context";

const RAIZ = workspaceRoot(import.meta.url);

let work = "";
let proyecto = "";
let coleccion = "";

/**
 * Spawns the real CLI.
 *
 * With `node:child_process` and not `Bun.spawn`: vitest runs in Node
 * workers, where `Bun` is not defined — same reason `runner.helper`
 * in the plugin carries its own documented fallback.
 */
function cli(args: readonly string[]): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(
      "bun",
      ["run", join(RAIZ, "packages/cli/cli.script.ts"), ...args],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "check-tool-"));
  proyecto = join(work, "api");
  await cp(join(RAIZ, "examples/example-graphql"), proyecto, { recursive: true });
  await rm(join(proyecto, "tanit"), { recursive: true, force: true });
  await cli(["generate", "--project-root", proyecto]);
  coleccion = join(proyecto, "tanit", "sample-graphql.postman_collection.json");
}, 180_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

async function check(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const handler = await captureHandler(
    buildCheckToolRegistration(makeContext({ workspaceRoot: RAIZ })),
  );
  const result = await handler(input);
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("una colección al día", () => {
  test("dice que sí, y con las cifras", { timeout: 120_000 }, async () => {
    const out = await check({ projectRoot: proyecto });
    expect(out["ok"]).toBe(true);
    expect(out["inSync"]).toBe(true);
    expect(out["routesInSource"]).toBe(5);
    expect(out["requestsInCollection"]).toBe(5);
  });

  test("las listas de deriva vienen vacías, no ausentes", { timeout: 120_000 }, async () => {
    const out = await check({ projectRoot: proyecto });
    expect(out["missingInCollection"]).toEqual([]);
    expect(out["missingInSource"]).toEqual([]);
  });
});

describe("una colección desincronizada", () => {
  /**
   * THE test. A collection with **detected** drift is a check that
   * worked: `ok` stays `true` and what changes is `inSync`. Returning
   * it as a tool error would make the agent retry instead of
   * reading the list.
   */
  test("`ok` sigue en true; lo que cambia es `inSync`", { timeout: 120_000 }, async () => {
    const original = await readFile(coleccion, "utf8");
    try {
      const doc = JSON.parse(original) as { item: Array<{ item?: unknown[] }> };
      const carpeta = doc.item.find((f) => Array.isArray(f.item) && f.item.length > 1);
      carpeta!.item = carpeta!.item!.slice(1);
      await writeFile(coleccion, JSON.stringify(doc, null, 2));

      const out = await check({ projectRoot: proyecto });
      expect(out["ok"]).toBe(true);
      expect(out["inSync"]).toBe(false);
    } finally {
      await writeFile(coleccion, original);
    }
  });

  /**
   * In GraphQL the five operations share `POST /graphql`, so a list
   * without names would be several identical lines: it would not
   * say which one is missing.
   */
  test("dice qué operación falta, no solo cuántas", { timeout: 120_000 }, async () => {
    const original = await readFile(coleccion, "utf8");
    try {
      const doc = JSON.parse(original) as { item: Array<{ item?: unknown[] }> };
      const carpeta = doc.item.find((f) => Array.isArray(f.item) && f.item.length > 1);
      carpeta!.item = carpeta!.item!.slice(1);
      await writeFile(coleccion, JSON.stringify(doc, null, 2));

      const out = await check({ projectRoot: proyecto });
      const faltan = out["missingInCollection"] as Array<{ name?: string }>;
      expect(faltan.length).toBeGreaterThan(0);
      expect(faltan.every((e) => typeof e.name === "string" && e.name.length > 0)).toBe(
        true,
      );
    } finally {
      await writeFile(coleccion, original);
    }
  });
});

/**
 * The other protocol, which was 91% uncovered.
 *
 * This spec only tested **GraphQL**, and GraphQL was one of the
 * nine frameworks where `check` worked. The bug — 13 of 22 examples
 * reporting total drift on a freshly generated collection — lived in
 * the rest, and no test was looking at it.
 *
 * Express is the exact opposite of GraphQL: REST with path params,
 * where the URL identifies the operation and the name is noise.
 * Together the two cases pin down the rule.
 */
describe("un REST con parámetros de ruta", () => {
  let rest = "";

  beforeAll(async () => {
    rest = join(work, "rest");
    await cp(join(RAIZ, "examples/example-express"), rest, { recursive: true });
    await rm(join(rest, "tanit"), { recursive: true, force: true });
    await cli(["generate", "--project-root", rest]);
  }, 180_000);

  /**
   * The test that was missing. `/api/users/:id` in the code and
   * `/api/users/{{id}}` in the collection are the same endpoint,
   * and "Get Users" is a name the constructor derives, not a second
   * operation.
   */
  test("una colección recién generada está al día", { timeout: 120_000 }, async () => {
    const out = await check({ projectRoot: rest });
    expect(out["ok"]).toBe(true);
    expect(out["inSync"], JSON.stringify(out["missingInCollection"])).toBe(true);
    expect(out["missingInCollection"]).toEqual([]);
    expect(out["missingInSource"]).toEqual([]);
  });

  /** And real drift is still detected. */
  test("borrar una request sí sale como deriva", { timeout: 120_000 }, async () => {
    const ruta = join(rest, "tanit", "sample-express.postman_collection.json");
    const original = await readFile(ruta, "utf8");
    try {
      const doc = JSON.parse(original) as { item: Array<{ item?: unknown[] }> };
      const carpeta = doc.item.find((f) => Array.isArray(f.item) && f.item.length > 1);
      carpeta!.item = carpeta!.item!.slice(1);
      await writeFile(ruta, JSON.stringify(doc, null, 2));

      const out = await check({ projectRoot: rest });
      expect(out["inSync"]).toBe(false);
      expect((out["missingInCollection"] as unknown[]).length).toBeGreaterThan(0);
    } finally {
      await writeFile(ruta, original);
    }
  });
});

describe("what it cannot do, it says", () => {
  test("un projectRoot que no existe da error con salida", async () => {
    const handler = await captureHandler(
      buildCheckToolRegistration(makeContext({ workspaceRoot: RAIZ })),
    );
    const result = await handler({ projectRoot: "/no/existe/zzz" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? "").toContain("no existe");
  });

  test("sin colección generada, dice que hay que generar primero", { timeout: 120_000 }, async () => {
    const vacio = join(work, "sin-generar");
    await cp(join(RAIZ, "examples/example-express"), vacio, { recursive: true });
    await rm(join(vacio, "tanit"), { recursive: true, force: true });

    const handler = await captureHandler(
      buildCheckToolRegistration(makeContext({ workspaceRoot: RAIZ })),
    );
    const result = await handler({ projectRoot: vacio });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? "").toContain("generate");
  });
});
