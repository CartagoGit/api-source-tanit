/**
 * El tool `check`, que era el que más falta hacía.
 *
 * Responde «¿se ha desincronizado mi colección del código?» — la
 * pregunta que un agente quiere hacer antes de tocar nada, y que no
 * podía: el comando existía en el CLI desde el principio y el plugin no
 * lo exponía. Cuatro tools para doce comandos.
 *
 * Lo que se comprueba de fondo es que devuelve **datos**, no la tabla
 * que imprime el CLI: un agente que parsee texto con regex se rompe el
 * día que cambia una columna, y ese hack ya se pagó antes aquí mismo.
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
 * Lanza el CLI de verdad.
 *
 * Con `node:child_process` y no con `Bun.spawn`: vitest corre en workers
 * de Node, donde `Bun` no está definido — es el mismo motivo por el que
 * `runner.helper` del plugin lleva su propio fallback documentado.
 */
function cli(args: readonly string[]): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(
      "bun",
      ["run", join(RAIZ, "projects/cli/cli.script.ts"), ...args],
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
  await rm(join(proyecto, "export-to-postman"), { recursive: true, force: true });
  await cli(["generate", "--project-root", proyecto]);
  coleccion = join(proyecto, "export-to-postman", "sample-graphql.postman_collection.json");
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
   * EL test. Una colección con deriva **detectada** es una comprobación
   * que ha funcionado: `ok` sigue siendo `true` y lo que cambia es
   * `inSync`. Devolverlo como error de herramienta haría que el agente
   * reintentara en vez de leer la lista.
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
   * En GraphQL las cinco operaciones comparten `POST /graphql`, así que
   * una lista sin nombres serían varias líneas idénticas: no diría cuál
   * falta.
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
 * El otro protocolo, que era el 91 % sin cubrir.
 *
 * Este spec probaba **solo GraphQL**, y GraphQL estaba entre los nueve
 * frameworks donde `check` funcionaba. El bug —13 de 22 ejemplos
 * reportando deriva total sobre una colección recién generada— vivía en
 * el resto, y ningún test lo miraba.
 *
 * Express es el contrario exacto de GraphQL: REST con parámetros de
 * ruta, donde la URL identifica la operación y el nombre es ruido. Los
 * dos casos juntos son los que fijan la regla.
 */
describe("un REST con parámetros de ruta", () => {
  let rest = "";

  beforeAll(async () => {
    rest = join(work, "rest");
    await cp(join(RAIZ, "examples/example-express"), rest, { recursive: true });
    await rm(join(rest, "export-to-postman"), { recursive: true, force: true });
    await cli(["generate", "--project-root", rest]);
  }, 180_000);

  /**
   * EL test que faltaba. `/api/users/:id` en el código y
   * `/api/users/{{id}}` en la colección son el mismo endpoint, y
   * «Get Users» es un nombre que deriva el constructor, no una segunda
   * operación.
   */
  test("una colección recién generada está al día", { timeout: 120_000 }, async () => {
    const out = await check({ projectRoot: rest });
    expect(out["ok"]).toBe(true);
    expect(out["inSync"], JSON.stringify(out["missingInCollection"])).toBe(true);
    expect(out["missingInCollection"]).toEqual([]);
    expect(out["missingInSource"]).toEqual([]);
  });

  /** Y la deriva de verdad se sigue viendo. */
  test("borrar una request sí sale como deriva", { timeout: 120_000 }, async () => {
    const ruta = join(rest, "export-to-postman", "sample-express.postman_collection.json");
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

describe("lo que no puede hacer, lo dice", () => {
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
    await rm(join(vacio, "export-to-postman"), { recursive: true, force: true });

    const handler = await captureHandler(
      buildCheckToolRegistration(makeContext({ workspaceRoot: RAIZ })),
    );
    const result = await handler({ projectRoot: vacio });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? "").toContain("generate");
  });
});
