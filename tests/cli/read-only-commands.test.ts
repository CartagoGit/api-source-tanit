/**
 * Los cuatro comandos que solo leen: `scan`, `list`, `stats`, `summary`.
 *
 * Ninguno tenía test. La auditoría dijo que ahí viviría el siguiente
 * bug, y vivía: **`list` no listaba nada**. Imprimía «9 endpoints en la
 * colección, agrupados por zona:» y dejaba la pantalla en blanco, en los
 * veintiún frameworks, porque recorría `config.zoneOrder` para imprimir
 * y en zero-config esa lista viene vacía — todos los endpoints caen en
 * `defaultZone`, que no está en ella. `stats` tenía el mismo fallo en su
 * sección «Por zona». Un comando entero sin salida útil, y el otro con
 * una sección muerta.
 *
 * Cada comando se ejercita contra un proyecto REST y uno de **RPC sobre
 * POST**, porque es donde la suposición de que la URL identifica la
 * operación ha mordido cuatro veces: en GraphQL las cinco operaciones
 * comparten `POST /graphql`.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_COMMANDS_DIR, exampleDir } from "../../scripts/helpers/root.helper";
import { copyExampleClean } from "../helpers/fixtures";
import { runProcess } from "../helpers/run-process";

/** Proyectos de prueba: uno REST y uno de RPC sobre POST. */
const PROYECTOS = [
  { framework: "express", endpoints: 9, rpc: false },
  { framework: "graphql", endpoints: 5, rpc: true },
] as const;

let work = "";
const raiz = new Map<string, string>();

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "read-only-"));
  for (const { framework } of PROYECTOS) {
    const root = join(work, framework);
    await copyExampleClean(exampleDir(framework), root);
    await runProcess("bun", [
      join(CLI_COMMANDS_DIR, "generate.script.ts"),
      "--project-root",
      root,
    ]);
    raiz.set(framework, root);
  }
}, 240_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

function run(comando: string, framework: string): Promise<{ code: number; output: string }> {
  return runProcess("bun", [
    join(CLI_COMMANDS_DIR, `${comando}.script.ts`),
    "--project-root",
    raiz.get(framework) ?? "",
  ]);
}

describe.each(PROYECTOS)("sobre $framework", ({ framework, endpoints, rpc }) => {
  test("scan encuentra el proyecto y sus rutas", { timeout: 120_000 }, async () => {
    const { code, output } = await run("scan", framework);
    expect(code, output).toBe(0);
    expect(output).toContain(framework);
    expect(output).toMatch(new RegExp(`${endpoints} rutas`));
  });

  /**
   * EL test. Sin él, `list` decía cuántos había y no enseñaba ninguno.
   */
  test("list enseña los endpoints, no solo cuántos", { timeout: 120_000 }, async () => {
    const { code, output } = await run("list-endpoints", framework);
    expect(code, output).toBe(0);
    expect(output).toContain(`${endpoints} endpoints`);
    // Una línea por endpoint, con su método.
    const lineas = output.split("\n").filter((l) => /^\s{2}(GET|POST|PUT|PATCH|DELETE)\s/.test(l));
    expect(lineas.length).toBe(endpoints);
  });

  test("list agrupa bajo una cabecera de zona", { timeout: 120_000 }, async () => {
    const { output } = await run("list-endpoints", framework);
    expect(output).toMatch(/─── .+ \(\d+\) ───/);
  });

  test("stats cuenta lo mismo que list", { timeout: 120_000 }, async () => {
    const { code, output } = await run("stats", framework);
    expect(code, output).toBe(0);
    expect(output).toContain(`Total requests: ${endpoints}`);
  });

  test("stats no deja la sección de zonas vacía", { timeout: 120_000 }, async () => {
    const { output } = await run("stats", framework);
    const zonas = output.slice(output.indexOf("Por zona:"));
    expect(zonas).toMatch(/─── .+ \(\d+\) ───/);
  });

  test("summary cuenta los mismos endpoints que list", { timeout: 120_000 }, async () => {
    const { code, output } = await run("summary", framework);
    expect(code, output).toBe(0);
    // Lee el **código**, no la colección, así que la cifra tiene que
    // coincidir con la de `list` sin haber mirado el fichero.
    expect(output).toMatch(new RegExp(`Endpoints:\\s+${endpoints}`));
    expect(output).toContain(framework);
  });

  /**
   * En RPC sobre POST las operaciones comparten método y URL, así que un
   * listado sin nombres son cinco líneas idénticas: no dice nada.
   */
  test.skipIf(!rpc)(
    "list distingue las operaciones que comparten endpoint",
    { timeout: 120_000 },
    async () => {
      const { output } = await run("list-endpoints", framework);
      const nombres = output
        .split("\n")
        .filter((l) => l.includes("POST"))
        .map((l) => l.trim());
      expect(new Set(nombres).size).toBe(endpoints);
    },
  );
});

describe("sin colección en disco", () => {
  let vacio = "";

  beforeAll(async () => {
    vacio = join(work, "sin-coleccion");
    await copyExampleClean(exampleDir("express"), vacio);
  }, 60_000);

  /**
   * `list` y `stats` leen la colección. Sin ella soltaban el volcado de
   * Bun —cinco líneas de ENOENT con el código fuente del comando
   * encima— y ni una palabra sobre qué hacer, cuando la respuesta es
   * siempre la misma: generar primero.
   *
   * Un error que no dice la salida deja a quien lo lee igual de
   * atascado, y encima parece que la herramienta se ha roto.
   */
  test.for(["list-endpoints", "stats"] as const)(
    "%s explica que falta la colección y cómo generarla",
    { timeout: 120_000 },
    async (comando) => {
      const { code, output } = await runProcess("bun", [
        join(CLI_COMMANDS_DIR, `${comando}.script.ts`),
        "--project-root",
        vacio,
      ]);
      expect(code).toBe(1);
      expect(output).toContain("No hay ninguna colección");
      // La salida, no solo el diagnóstico.
      expect(output).toContain("generate");
      // Y nada del volcado que había antes.
      expect(output).not.toContain("ENOENT");
      expect(output).not.toContain("syscall");
    },
  );

  /** `summary` y `scan` leen el código, así que no necesitan colección. */
  test.for(["summary", "scan"] as const)(
    "%s funciona igual sin colección",
    { timeout: 120_000 },
    async (comando) => {
      const { code } = await runProcess("bun", [
        join(CLI_COMMANDS_DIR, `${comando}.script.ts`),
        "--project-root",
        vacio,
      ]);
      expect(code).toBe(0);
    },
  );
});
