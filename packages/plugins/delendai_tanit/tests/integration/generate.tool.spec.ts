/**
 * Integration tests de `buildGenerateToolRegistration`.
 *
 * El tool no importa el CLI: lo **spawnea**. Así que lo único que se
 * puede comprobar de verdad es ejecutándolo, y eso es justo lo que aquí
 * no se estaba haciendo — el plugin llevaba commits apuntando a un
 * `scripts/cli.script.ts` que ya no existía y ningún test lo notó,
 * porque ninguno llegaba a spawnear nada.
 *
 * El caso que da sentido a `framework`: un proyecto **sin manifiesto**,
 * donde la detección no puede acertar por mucho que se la mejore.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdtemp, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildGenerateToolRegistration } from "../../src/lib/tools/generate.tool";
import { captureHandler, makeContext, workspaceRoot } from "../helpers/plugin-context";

/** Raíz del proyecto tanit (no la del plugin). */
const TANIT_ROOT = workspaceRoot(import.meta.url);

const makeCtx = (options: Record<string, unknown> = {}) =>
  makeContext({ workspaceRoot: TANIT_ROOT, options });

/** Copia del fixture de Fastify sin su `package.json`, y dónde escribir. */
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

  // Este es el test que habría cazado la ruta muerta al CLI: es el único
  // que llega a ejecutar el binario de verdad.
  test(
    "sin `framework`, un proyecto sin manifiesto falla y el aviso ofrece la salida",
    { timeout: 120_000 },
    async () => {
      const handler = await captureHandler(buildGenerateToolRegistration(makeCtx()));
      const result = await handler({ projectRoot: sinManifiesto, outputDir: salida });
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? "";
      // Lo importante no es que falle: es que diga qué hacer.
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
 * Los formatos, desde el plugin.
 *
 * Existen seis y el plugin solo llegaba al primero: un agente al que le
 * piden "sácame el OpenAPI de esta API" no tenía forma de hacerlo aunque
 * el CLI supiera. La lista sale del registro de exportadores, igual que
 * `framework` sale del de scanners.
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
      // La colección sigue saliendo: los formatos extra se suman, no
      // sustituyen.
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
