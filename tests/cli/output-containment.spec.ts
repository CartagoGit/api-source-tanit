/**
 * La salida no se sale, cuando quien la elige es un agente.
 *
 * `--output-dir` se aceptaba tal cual. Lanzado a mano eso está bien: si
 * alguien escribe `--output-dir /tmp/x`, es porque quiere escribir ahí.
 * Pero el plugin MCP spawnea este mismo CLI con argumentos que vienen de
 * un agente, y entonces un `../` acaba escribiendo fuera del proyecto.
 *
 * La contención no es global a propósito: la impone `POSTMAN_CONTAIN_ROOT`,
 * que pone el plugin al lanzar. Quien usa la terminal no la ve.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_COMMANDS_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { runProcess } from "../helpers/run-process";

const GENERATE = join(CLI_COMMANDS_DIR, "generate.script.ts");

let base = "";
let proyecto = "";

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "contain-cli-")));
  proyecto = join(base, "api");
  await copyExampleClean(exampleDir("express"), proyecto);
}, 120_000);

afterAll(async () => {
  if (base) await rm(base, { recursive: true, force: true });
});

function generate(
  args: readonly string[],
  env?: Record<string, string>,
): Promise<{ code: number; output: string }> {
  return runProcess("bun", [GENERATE, ...args], env ? { env } : {});
}

describe("sin contención — quien lo lanza a mano manda", () => {
  test("una carpeta de salida fuera del proyecto funciona", { timeout: 120_000 }, async () => {
    const fuera = join(base, "salida-elegida");
    const r = await generate(["--project-root", proyecto, "--output-dir", fuera]);
    expect(r.code, r.output).toBe(0);
  });
});

describe("con contención — quien la elige es un agente", () => {
  const conRaiz = (raiz: string): Record<string, string> => ({
    POSTMAN_CONTAIN_ROOT: raiz,
  });

  // EL test: sin la comprobación, esto escribía fuera y salía con 0.
  test("una ruta que se sale se rechaza", { timeout: 120_000 }, async () => {
    const fuera = join(base, "no-deberia-existir");
    const r = await generate(
      ["--project-root", proyecto, "--output-dir", fuera],
      conRaiz(proyecto),
    );
    expect(r.code).toBe(1);
  });

  test("dice por qué y quién lo impone, sin traza", { timeout: 120_000 }, async () => {
    const r = await generate(
      ["--project-root", proyecto, "--output-dir", join(base, "fuera")],
      conRaiz(proyecto),
    );
    // El gate lint:output-language obliga a la superficie en inglés,
    // y el `reason` del helper de contención ya la trae en inglés
    // ("is outside"); lo que el CLI añade alrededor se pinza aquí.
    expect(r.output).toMatch(/is outside/);
    expect(r.output).toContain("POSTMAN_CONTAIN_ROOT");
    expect(r.output).toContain("POSTMAN_CONTAIN_ROOT");
    expect(r.output).not.toMatch(/at <anonymous>/);
  });

  test("un `../` tampoco cuela", { timeout: 120_000 }, async () => {
    const r = await generate(
      ["--project-root", proyecto, "--output-dir", join(proyecto, "..", "escapada")],
      conRaiz(proyecto),
    );
    expect(r.code).toBe(1);
  });

  test("dentro de la raíz sigue funcionando igual", { timeout: 120_000 }, async () => {
    const dentro = join(proyecto, "salida-propia");
    const r = await generate(
      ["--project-root", proyecto, "--output-dir", dentro],
      conRaiz(proyecto),
    );
    expect(r.code, r.output).toBe(0);
  });
});
