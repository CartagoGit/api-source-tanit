/**
 * Integration tests for `buildGenerateToolRegistration`.
 *
 * The tool does not import the CLI: it **spawns** it. So the only
 * thing we can really check is by running it, which is exactly what
 * was not happening here — the plugin shipped commits pointing at
 * a `scripts/cli.script.ts` that no longer existed and no test
 * noticed, because none of them ever actually spawned anything.
 *
 * The case that gives `framework` its meaning: a project **without a
 * manifest**, where detection cannot succeed no matter how much it
 * improves.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdtemp, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildGenerateToolRegistration } from "../../src/lib/tools/generate.tool";
import { captureHandler, makeContext, workspaceRoot } from "../helpers/plugin-context";

/** Root of the tanit project (not the plugin's). */
const TANIT_ROOT = workspaceRoot(import.meta.url);

const makeCtx = (options: Record<string, unknown> = {}) =>
  makeContext({ workspaceRoot: TANIT_ROOT, options });

/** Copy of the Fastify fixture without its `package.json`, and where to write. */
let sinManifiesto = "";
let salida = "";
let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "tanit-generate-tool-"));
  sinManifiesto = join(workDir, "api");
  salida = join(workDir, "out");
  await cp(join(TANIT_ROOT, "tests", "fixtures", "fastify-comprehensive"), sinManifiesto, {
    recursive: true,
  });
  await unlink(join(sinManifiesto, "package.json"));
}, 60_000);

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

interface IGenerateResult {
  readonly ok: boolean;
  readonly framework: string | null;
  readonly requests: number;
  readonly collectionPath: string | null;
}

describe("tanit_generate", () => {
  test("registra el tool con id='generate' y declara que escribe", () => {
    const reg = buildGenerateToolRegistration(makeCtx());
    expect(reg.id).toBe("generate");
    expect(reg.effects).toContain("write");
    expect(reg.effects).toContain("spawn");
  });

  test("rechaza un framework que no está en el registro", async () => {
    const handler = await captureHandler(buildGenerateToolRegistration(makeCtx()));
    const result = await handler({ projectRoot: sinManifiesto, framework: "inventado" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Input inválido/i);
  });

  test("devuelve error si projectRoot no existe", async () => {
    const handler = await captureHandler(buildGenerateToolRegistration(makeCtx()));
    const result = await handler({ projectRoot: "/tmp/__no_existe_zzzz__" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/no existe/);
  });

  // This is the test that would have caught the dead CLI path: it is
  // the only one that actually executes the binary.
  test(
    "without `framework`, a manifestless project fails and the warning offers the way out",
    { timeout: 120_000 },
    async () => {
      const handler = await captureHandler(buildGenerateToolRegistration(makeCtx()));
      const result = await handler({ projectRoot: sinManifiesto, outputDir: salida });
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? "";
      // What matters is not that it fails: it is that it says what to do.
      expect(text).toMatch(/framework/);
      expect(text).toMatch(/fastify/);
    },
  );

  test(
    "con `framework`, el mismo proyecto genera su colección",
    { timeout: 120_000 },
    async () => {
      const handler = await captureHandler(buildGenerateToolRegistration(makeCtx()));
      const result = await handler({
        projectRoot: sinManifiesto,
        outputDir: salida,
        framework: "fastify",
      });
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0]?.text ?? "{}") as IGenerateResult;
      expect(parsed.ok).toBe(true);
      expect(parsed.framework).toBe("fastify");
      expect(parsed.requests).toBeGreaterThan(5);
      expect(parsed.collectionPath).toContain(salida);
    },
  );
});

/**
 * The formats, from the plugin.
 *
 * There are six and the plugin only reached the first one: an agent
 * asked to "give me the OpenAPI of this API" had no way to do it
 * even though the CLI knew how. The list comes from the exporters
 * registry, same as `framework` comes from the scanners registry.
 */
describe("tanit_generate — formatos", () => {
  test("rechaza un formato que no está en el registro", async () => {
    const handler = await captureHandler(buildGenerateToolRegistration(makeCtx()));
    const result = await handler({ projectRoot: sinManifiesto, formats: ["inventado"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Input inválido/i);
  });

  test(
    "pide OpenAPI y cURL además de la colección",
    { timeout: 120_000 },
    async () => {
      const handler = await captureHandler(buildGenerateToolRegistration(makeCtx()));
      const result = await handler({
        projectRoot: sinManifiesto,
        outputDir: salida,
        framework: "fastify",
        formats: ["postman", "openapi", "curl"],
      });
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0]?.text ?? "{}") as {
        collectionPath: string | null;
        extraPaths: string[];
      };
      // The collection is still emitted: the extra formats are added,
      // not substituted.
      expect(parsed.collectionPath).toContain(salida);
      expect(parsed.extraPaths.some((p) => p.endsWith(".openapi.yaml"))).toBe(true);
      expect(parsed.extraPaths.some((p) => p.endsWith(".curl.sh"))).toBe(true);
    },
  );

  test(
    "sin `formats`, solo la colección",
    { timeout: 120_000 },
    async () => {
      const handler = await captureHandler(buildGenerateToolRegistration(makeCtx()));
      const result = await handler({
        projectRoot: sinManifiesto,
        outputDir: salida,
        framework: "fastify",
      });
      const parsed = JSON.parse(result.content[0]?.text ?? "{}") as { extraPaths: string[] };
      expect(parsed.extraPaths).toEqual([]);
    },
  );
});
