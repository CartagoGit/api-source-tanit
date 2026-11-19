/**
 * The `scan` tool: what discovery sees before generating anything.
 *
 * It is the answer to "why does it not find my routes?", which
 * until now an agent could only answer by generating the whole
 * collection and inferring it from the result.
 *
 * Two things are checked here that no other test covers:
 *
 *   · That **not recognising anything is a result**, not a failure.
 *     Returning it as a tool error would make the agent retry
 *     instead of reading `artifacts` empty and understanding why.
 *   · That the module can be **imported**. `scan.script.ts` called
 *     `process.exit(await main())` with no guard: loading it
 *     killed the process, which in a long-lived MCP server is the
 *     whole server crashing when the tool is registered. This file
 *     would not even compile if that came back.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildScanToolRegistration } from "../../src/lib/tools/scan.tool";
import { captureHandler, makeContext, workspaceRoot } from "../helpers/plugin-context";

const RAIZ = workspaceRoot(import.meta.url);

let work = "";
let proyecto = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "scan-tool-"));
  proyecto = join(work, "api");
  await cp(join(RAIZ, "examples/example-express"), proyecto, { recursive: true });
  await rm(join(proyecto, "tanit"), { recursive: true, force: true });
}, 180_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

async function scan(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const handler = await captureHandler(
    buildScanToolRegistration(makeContext({ workspaceRoot: RAIZ })),
  );
  const result = await handler(input);
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("un proyecto que sí se reconoce", () => {
  test("says which framework, and that it detected it", { timeout: 120_000 }, async () => {
    const out = await scan({ projectRoot: proyecto });
    expect(out["ok"]).toBe(true);
    expect(out["detected"]).toBe(true);
    expect(out["framework"]).toBe("express");
  });

  /**
   * The artefacts are the "why". Without them, a wrongly detected
   * framework is indistinguishable from a correctly detected one.
   */
  test("says by which artefacts it inferred it", { timeout: 120_000 }, async () => {
    const out = await scan({ projectRoot: proyecto });
    const artefactos = out["artifacts"] as string[];
    expect(artefactos.length).toBeGreaterThan(0);
    expect(artefactos).toContain("package.json");
  });

  test("names the scanner that walks the routes", { timeout: 120_000 }, async () => {
    const out = await scan({ projectRoot: proyecto });
    expect(out["scanner"]).toBe("ExpressRouteScanner");
  });

  test("returns the raw routes, with method and URI", { timeout: 120_000 }, async () => {
    const out = await scan({ projectRoot: proyecto });
    const rutas = out["routes"] as Array<{ method: string; uri: string }>;
    expect(rutas.length).toBeGreaterThan(0);
    expect(rutas.every((r) => r.method.length > 0 && r.uri.length > 0)).toBe(true);
  });

  /** The resolved root, so the agent knows what was actually looked at. */
  test("says which folder it scanned", { timeout: 120_000 }, async () => {
    const out = await scan({ projectRoot: proyecto });
    expect(out["root"]).toBe(proyecto);
  });
});

describe("un proyecto que no se reconoce", () => {
  /**
   * THE test. `ok` stays `true` because the scan ran; what says
   * there was no luck is `detected`. If this returned `isError`,
   * the agent would retry in a loop instead of reading that there
   * are no artefacts.
   */
  test("`ok` stays `true`; what changes is `detected`", { timeout: 120_000 }, async () => {
    const anonimo = join(work, "nada");
    await cp(join(RAIZ, "examples/example-express"), anonimo, { recursive: true });
    await rm(join(anonimo, "tanit"), { recursive: true, force: true });
    // With no manifest nor recognisable sources nothing is left to give it away.
    await rm(join(anonimo, "package.json"), { force: true });
    await rm(join(anonimo, "server.js"), { force: true });
    await writeFile(join(anonimo, "LEEME.txt"), "no soy una API\n");

    const out = await scan({ projectRoot: anonimo });
    expect(out["ok"]).toBe(true);
    expect(out["detected"]).toBe(false);
    expect(out["framework"]).toBeNull();
    expect(out["routes"]).toEqual([]);
  });
});

describe("lo que no puede hacer, lo dice", () => {
  test("un projectRoot que no existe da error con salida", async () => {
    const handler = await captureHandler(
      buildScanToolRegistration(makeContext({ workspaceRoot: RAIZ })),
    );
    const result = await handler({ projectRoot: "/no/existe/zzz" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? "").toContain("no existe");
  });
});
