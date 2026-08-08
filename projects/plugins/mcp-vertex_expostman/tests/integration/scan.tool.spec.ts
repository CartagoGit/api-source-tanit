/**
 * El tool `scan`: qué ve el discovery antes de generar nada.
 *
 * Es la respuesta a «¿por qué no encuentra mis rutas?», que hasta ahora
 * un agente solo podía contestar generando la colección entera y
 * deduciéndolo del resultado.
 *
 * Dos cosas se comprueban aquí que ningún otro test cubre:
 *
 *   · Que **no reconocer nada es un resultado**, no un fallo. Devolverlo
 *     como error de herramienta haría que el agente reintentara en vez
 *     de leer `artifacts` vacío y entender por qué.
 *   · Que el módulo se puede **importar**. `scan.script.ts` llamaba a
 *     `process.exit(await main())` sin guard: cargarlo mataba el
 *     proceso, que en un servidor MCP de vida larga es el servidor
 *     entero cayéndose al registrar el tool. Este fichero no compilaría
 *     siquiera si eso volviera.
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
  await rm(join(proyecto, "export-to-postman"), { recursive: true, force: true });
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
  test("dice qué framework, y que lo detectó", { timeout: 120_000 }, async () => {
    const out = await scan({ projectRoot: proyecto });
    expect(out["ok"]).toBe(true);
    expect(out["detected"]).toBe(true);
    expect(out["framework"]).toBe("express");
  });

  /**
   * Los artefactos son el «por qué». Sin ellos, un framework mal
   * detectado es indistinguible de uno bien detectado.
   */
  test("dice por qué artefactos lo dedujo", { timeout: 120_000 }, async () => {
    const out = await scan({ projectRoot: proyecto });
    const artefactos = out["artifacts"] as string[];
    expect(artefactos.length).toBeGreaterThan(0);
    expect(artefactos).toContain("package.json");
  });

  test("nombra el scanner que recorre las rutas", { timeout: 120_000 }, async () => {
    const out = await scan({ projectRoot: proyecto });
    expect(out["scanner"]).toBe("ExpressScanner");
  });

  test("devuelve las rutas crudas, con método y URI", { timeout: 120_000 }, async () => {
    const out = await scan({ projectRoot: proyecto });
    const rutas = out["routes"] as Array<{ method: string; uri: string }>;
    expect(rutas.length).toBeGreaterThan(0);
    expect(rutas.every((r) => r.method.length > 0 && r.uri.length > 0)).toBe(true);
  });

  /** La raíz resuelta, para que el agente sepa qué se miró de verdad. */
  test("dice qué carpeta escaneó", { timeout: 120_000 }, async () => {
    const out = await scan({ projectRoot: proyecto });
    expect(out["root"]).toBe(proyecto);
  });
});

describe("un proyecto que no se reconoce", () => {
  /**
   * EL test. `ok` sigue en `true` porque el escaneo se hizo; lo que dice
   * que no hubo suerte es `detected`. Si esto devolviera `isError`, el
   * agente reintentaría en bucle en vez de leer que no hay artefactos.
   */
  test("`ok` sigue en true; lo que cambia es `detected`", { timeout: 120_000 }, async () => {
    const anonimo = join(work, "nada");
    await cp(join(RAIZ, "examples/example-express"), anonimo, { recursive: true });
    await rm(join(anonimo, "export-to-postman"), { recursive: true, force: true });
    // Sin manifiesto ni fuentes reconocibles no queda nada que delatar.
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
