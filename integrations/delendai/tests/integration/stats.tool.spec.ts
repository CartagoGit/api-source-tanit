/**
 * The `stats` tool: the size and shape of the collection, as data.
 *
 * What we really check is that **the numbers balance by themselves**:
 * the total must equal the sum of the methods and also the sum of
 * the zones. A breakdown that does not add up to its own total is the
 * kind of data an agent uses to decide badly without noticing.
 *
 * And that it is emitted as data, not as the table the CLI prints,
 * which aligns with `padEnd` based on the longest folder name — i.e.
 * the column width changes between projects.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildStatsToolRegistration } from "../../src/lib/tools/stats.tool";
import { captureHandler, makeContext, workspaceRoot } from "../helpers/plugin-context";

const RAIZ = workspaceRoot(import.meta.url);

let work = "";
let proyecto = "";

/** El CLI de verdad, por subproceso: vitest corre en workers de Node. */
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
  work = await mkdtemp(join(tmpdir(), "stats-tool-"));
  proyecto = join(work, "api");
  await cp(join(RAIZ, "examples/example-express"), proyecto, { recursive: true });
  await rm(join(proyecto, "tanit"), { recursive: true, force: true });
  await cli(["generate", "--project-root", proyecto]);
}, 180_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

interface IZona {
  zone: string;
  total: number;
  byFolder: Array<{ folder: string; count: number }>;
}

async function stats(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const handler = await captureHandler(
    buildStatsToolRegistration(makeContext({ workspaceRoot: RAIZ })),
  );
  const result = await handler(input);
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("las cifras de la colección", () => {
  test("returns the total, which is not zero", { timeout: 120_000 }, async () => {
    const out = await stats({ projectRoot: proyecto });
    expect(out["ok"]).toBe(true);
    expect(out["total"]).toBeGreaterThan(0);
  });

  /** THE test: a breakdown that does not sum to its own total is worthless. */
  test("the per-method breakdown sums to the total", { timeout: 120_000 }, async () => {
    const out = await stats({ projectRoot: proyecto });
    const porMetodo = out["byMethod"] as Array<{ method: string; count: number }>;
    const suma = porMetodo.reduce((a, m) => a + m.count, 0);
    expect(suma).toBe(out["total"]);
  });

  test("the per-zone breakdown also sums to the total", { timeout: 120_000 }, async () => {
    const out = await stats({ projectRoot: proyecto });
    const zonas = out["zones"] as IZona[];
    expect(zonas.reduce((a, z) => a + z.total, 0)).toBe(out["total"]);
  });

  test("and within each zone, the folders sum to the zone", { timeout: 120_000 }, async () => {
    const out = await stats({ projectRoot: proyecto });
    for (const zona of out["zones"] as IZona[]) {
      expect(zona.byFolder.reduce((a, f) => a + f.count, 0)).toBe(zona.total);
    }
  });

  test("methods come largest to smallest, as printed", { timeout: 120_000 }, async () => {
    const out = await stats({ projectRoot: proyecto });
    const cuentas = (out["byMethod"] as Array<{ count: number }>).map((m) => m.count);
    expect([...cuentas].sort((a, b) => b - a)).toEqual(cuentas);
  });

  /**
   * A project with no zone configuration has one, the default. That
   * it appears — instead of an empty list — is what makes the data
   * interpretable without knowing the configuration.
   */
  test("without zone configuration, the default one appears", { timeout: 120_000 }, async () => {
    const out = await stats({ projectRoot: proyecto });
    const zonas = out["zones"] as IZona[];
    expect(zonas.length).toBeGreaterThan(0);
    expect(zonas.every((z) => z.total > 0)).toBe(true);
  });
});

describe("lo que no puede hacer, lo dice", () => {
  test("un projectRoot que no existe da error con salida", async () => {
    const handler = await captureHandler(
      buildStatsToolRegistration(makeContext({ workspaceRoot: RAIZ })),
    );
    const result = await handler({ projectRoot: "/no/existe/zzz" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? "").toContain("no existe");
  });

  test("without a generated collection, says to generate first", { timeout: 120_000 }, async () => {
    const vacio = join(work, "sin-generar");
    await cp(join(RAIZ, "examples/example-express"), vacio, { recursive: true });
    await rm(join(vacio, "tanit"), { recursive: true, force: true });

    const handler = await captureHandler(
      buildStatsToolRegistration(makeContext({ workspaceRoot: RAIZ })),
    );
    const result = await handler({ projectRoot: vacio });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? "").toContain("generate");
  });
});
