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

/** Raíz del proyecto export-to-postman (no la del plugin). */
const EXPOSTMAN_ROOT = workspaceRoot(import.meta.url);

const makeCtx = (options: Record<string, unknown> = {}) =>
  makeContext({ workspaceRoot: EXPOSTMAN_ROOT, options });

/** Copia del fixture de Fastify sin su `package.json`, y dónde escribir. */
let sinManifiesto = "";
let salida = "";
let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "expostman-generate-tool-"));
  sinManifiesto = join(workDir, "api");
  salida = join(workDir, "out");
  await cp(join(EXPOSTMAN_ROOT, "tests", "fixtures", "fastify-comprehensive"), sinManifiesto, {
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

describe("expostman_generate", () => {
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
