/**
 * Qué código de salida devuelve el CLI, y por qué importa.
 *
 * Un CLI se usa dentro de scripts: en un `Makefile`, en un paso de CI,
 * en un hook de pre-commit. Ahí el código de salida **es** el resultado;
 * la prosa que imprima no la lee nadie.
 *
 * Dos casos salían con 0 cuando no habían hecho lo que se les pidió:
 *
 *   - Cero endpoints encontrados: escribía una colección vacía y salía
 *     bien. Un paso de CI pasaba aunque el escaneo no hubiera visto
 *     nada, y alguien importaba una colección vacía sin enterarse.
 *   - Sin permiso de escritura: salía un `EACCES` con la traza de Bun
 *     encima. La información estaba, pero enterrada y sin decir qué
 *     hacer.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_COMMANDS_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { runProcess } from "../helpers/run-process";

const GENERATE = join(CLI_COMMANDS_DIR, "generate.script.ts");

let workDir = "";
let emptyProject = "";
let realProject = "";
let readOnlyProject = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "exit-codes-"));

  emptyProject = join(workDir, "vacio");
  await mkdir(emptyProject, { recursive: true });

  realProject = join(workDir, "api");
  await copyExampleClean(exampleDir("express"), realProject);

  readOnlyProject = join(workDir, "solo-lectura");
  await copyExampleClean(exampleDir("express"), readOnlyProject);
  await chmod(readOnlyProject, 0o555);
}, 60_000);

afterAll(async () => {
  if (readOnlyProject) await chmod(readOnlyProject, 0o755).catch(() => undefined);
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

const generate = (args: readonly string[]) => runProcess("bun", [GENERATE, ...args]);

describe("códigos de salida de `generate`", () => {
  test("un proyecto con endpoints sale con 0", async () => {
    const result = await generate(["--project-root", realProject]);
    expect(result.code, result.output).toBe(0);
  }, 60_000);

  // La regresión: esto salía con 0 y escribía una colección vacía.
  test("cero endpoints sale con 1 y no escribe nada", async () => {
    const result = await generate(["--project-root", emptyProject]);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/ningún endpoint/i);
  }, 60_000);

  test("el mensaje de cero endpoints dice qué hacer", async () => {
    const { output } = await generate(["--project-root", emptyProject]);
    expect(output).toMatch(/--project-root/);
    expect(output).toMatch(/FRAMEWORKS\.md/);
    expect(output).toMatch(/--allow-empty/);
  }, 60_000);

  // Un proyecto que aún no tiene rutas es un caso legítimo: se puede
  // pedir explícitamente que no falle.
  test("--allow-empty vuelve a salir con 0", async () => {
    const result = await generate(["--project-root", emptyProject, "--allow-empty"]);
    expect(result.code, result.output).toBe(0);
  }, 60_000);

  test("un projectRoot inexistente sale con 1 y lo dice", async () => {
    const result = await generate(["--project-root", join(workDir, "no-existe-zzz")]);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/no existe/i);
  }, 60_000);

  /**
   * Como **root** este escenario no existe: `chmod 0555` no impide
   * escribir a quien puede saltarse los permisos, así que el test
   * pasaría siempre sin comprobar nada. Se vio corriendo el gate dentro
   * de un contenedor, donde el usuario por defecto es root.
   *
   * Se salta con el motivo escrito, en vez de dejarlo pasar en verde:
   * un test que no puede fallar es peor que no tenerlo, porque además
   * cuenta como cobertura.
   */
  test.skipIf(typeof process.getuid === "function" && process.getuid?.() === 0)(
    "sin permiso de escritura sale con 1 y explica, sin traza",
    async () => {
    const result = await generate(["--project-root", readOnlyProject]);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/permiso/i);
    expect(result.output).toMatch(/--output-dir/);
      // Lo que NO debe salir: el volcado de Bun.
      expect(result.output).not.toMatch(/at <anonymous>/);
    },
    60_000,
  );
});
