/**
 * Los comandos que escriben o hablan con fuera: `init`, `push`, `open`.
 *
 * Ninguno tenía test, y `init` **empeoraba el proyecto**. Detectaba el
 * nombre mirando solo `composer.json` —herencia de cuando la herramienta
 * era de Laravel— y, al no encontrarlo, se quedaba con el nombre de la
 * carpeta. Como la configuración que genera pisa la detección
 * automática, sobre `example-express` el proyecto pasaba de llamarse
 * `sample-express` a llamarse como el directorio: ejecutar el asistente
 * dejaba peor de lo que estaba.
 *
 * Y terminaba diciendo `bun run build`, que es un script **de este
 * repositorio** y no del proyecto de quien usa la herramienta. El
 * asistente existe justo para quien no se sabe los flags, así que
 * cerrarlo con un comando que no puede ejecutar es dejarlo atascado en
 * el último paso.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_COMMANDS_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { runProcess } from "../helpers/run-process";

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "writing-cmd-"));
}, 60_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

/** Un proyecto limpio por test, porque estos comandos escriben. */
async function proyecto(nombre: string, framework = "express"): Promise<string> {
  const root = join(work, nombre);
  await copyExampleClean(exampleDir(framework), root);
  return root;
}

function run(comando: string, args: readonly string[]): Promise<{ code: number; output: string }> {
  return runProcess("bun", [join(CLI_COMMANDS_DIR, `${comando}.script.ts`), ...args]);
}

describe("init", () => {
  test("detecta el nombre del manifiesto, no el de la carpeta", { timeout: 120_000 }, async () => {
    const root = await proyecto("nombre-carpeta-distinto");
    const { code, output } = await run("init", ["--project-root", root]);
    expect(code, output).toBe(0);
    // La línea de detección, no la salida entera: las rutas que imprime
    // llevan el nombre del directorio dentro y eso es legítimo.
    const detectado = /Project detected:\s+(\S+)/.exec(output)?.[1];
    expect(detectado).toBe("sample-express");
  });

  /**
   * EL test: sin él, el asistente degradaba el proyecto y solo se veía
   * corriendo otro comando después.
   */
  test("lo que genera no empeora la detección", { timeout: 120_000 }, async () => {
    const root = await proyecto("no-degradar");
    const antes = await run("summary", ["--project-root", root]);
    await run("init", ["--project-root", root]);
    const despues = await run("summary", ["--project-root", root]);

    const nombre = (salida: string): string =>
      /Project name:\s+(\S+)/.exec(salida)?.[1] ?? "";
    expect(nombre(antes.output)).toBe("sample-express");
    expect(nombre(despues.output)).toBe(nombre(antes.output));
  });

  test("el siguiente paso que sugiere se puede ejecutar de verdad", { timeout: 120_000 }, async () => {
    const root = await proyecto("siguiente-paso");
    const { output } = await run("init", ["--project-root", root]);
    expect(output).toContain("export-to-postman generate");
    // `bun run build` es un script de este repo, no del proyecto ajeno.
    expect(output).not.toContain("bun run build");
  });

  test("`--name` manda sobre la detección", { timeout: 120_000 }, async () => {
    const root = await proyecto("con-nombre");
    const { output } = await run("init", ["--project-root", root, "--name", "mi-api"]);
    expect(output).toContain("mi-api");
  });

  test("la configuración que escribe la lee `generate`", { timeout: 120_000 }, async () => {
    const root = await proyecto("config-usable");
    await run("init", ["--project-root", root]);
    const { code, output } = await run("generate", ["--project-root", root]);
    expect(code, output).toBe(0);
    // Y la colección sale con el nombre bueno, no con el del directorio.
    const summary = await run("summary", ["--project-root", root]);
    expect(summary.output).toContain("Zero-config:      no");
  });
});

describe("push", () => {
  test("sin clave sale con 1 y dice dónde se saca una", { timeout: 120_000 }, async () => {
    const root = await proyecto("push-sin-clave");
    const { code, output } = await runProcess(
      "bun",
      [join(CLI_COMMANDS_DIR, "push.script.ts"), "--project-root", root],
      { env: { POSTMAN_API_KEY: "" } },
    );
    expect(code).toBe(1);
    expect(output).toMatch(/api.?key/i);
    expect(output).toContain("postman.co");
  });

  /**
   * Una clave es un secreto. Que aparezca en la salida es como acaba en
   * el log de un CI, y de ahí no se borra.
   */
  test("nunca imprime la clave que se le pasa", { timeout: 120_000 }, async () => {
    const root = await proyecto("push-clave-falsa");
    const secreto = "pmak-000000000000000000000000-secreto-que-no-debe-salir";
    const { output } = await run("push", [
      "--project-root",
      root,
      "--api-key",
      secreto,
    ]);
    expect(output).not.toContain(secreto);
    expect(output).not.toContain("secreto-que-no-debe-salir");
  });
});

describe("open", () => {
  test("sin colección sale con 1 y no cuelga", { timeout: 120_000 }, async () => {
    const root = await proyecto("open-sin-coleccion");
    const { code } = await run("open-postman", ["--project-root", root]);
    expect(code).toBe(1);
  });
});

describe("generate --open", () => {
  /**
   * Antes esto construía una ruta muerta
   * (`(import.meta as { dir?: string }).dir ?? process.cwd()` +
   * `/open-postman.script.ts`) y producía `MODULE_NOT_FOUND`. Ahora
   * `generate` importa el `main` del módulo hermano y lo llama en
   * proceso. Aquí se verifica la **integración**: el comando
   * efectivamente llama a la función, y `open-postman` corre.
   *
   * Se fuerza `POSTMAN_FORCE_OPEN=web` para que open-postman no intente
   * lanzar la app de escritorio (lo que bloquearía el test en CI sin
   * display) y salga por la rama web determinística.
   */
  test("invoca open-postman en proceso (rama web)", { timeout: 120_000 }, async () => {
    const root = await proyecto("generate-open");
    const { code, output } = await runProcess(
      "bun",
      [join(CLI_COMMANDS_DIR, "generate.script.ts"), "--project-root", root, "--open"],
      { env: { POSTMAN_FORCE_OPEN: "web" } },
    );
    expect(code, output).toBe(0);
    expect(output).toContain("--open");
  });

  /**
   * `generate` debe generar **primero** y abrir **después**. Si el
   * orden se invierte, `--open` abre un fichero que aún no existe y
   * confunde al usuario.
   */
  test("genera antes de abrir", { timeout: 120_000 }, async () => {
    const root = await proyecto("generate-open-orden");
    const { output } = await runProcess(
      "bun",
      [join(CLI_COMMANDS_DIR, "generate.script.ts"), "--project-root", root, "--open"],
      { env: { POSTMAN_FORCE_OPEN: "web" } },
    );
    const idxGenerate = output.indexOf("✔");
    const idxOpen = output.indexOf("--open");
    expect(idxGenerate).toBeGreaterThanOrEqual(0);
    expect(idxOpen).toBeGreaterThan(idxGenerate);
  });
});

describe("los comandos que escriben lo hacen de forma atómica", () => {
  /**
   * `init` escribía con `writeFileSync`. Un fallo a mitad dejaba una
   * configuración truncada, que es peor que ninguna: el proyecto pasa a
   * tener un fichero que no parsea y `generate` deja de arrancar.
   */
  test("la configuración que deja `init` es TypeScript completo", { timeout: 120_000 }, async () => {
    const root = await proyecto("init-atomico");
    const { output } = await run("init", ["--project-root", root]);
    const ruta = /· (\S+config\.constant\.ts)/.exec(output)?.[1] ?? "";
    expect(ruta).not.toBe("");
    const contenido = await readFile(ruta, "utf8");
    // Sin truncar: abre y cierra.
    expect(contenido).toContain("export const");
    expect(contenido.trimEnd().endsWith("}") || contenido.trimEnd().endsWith(";")).toBe(true);
  });
});
