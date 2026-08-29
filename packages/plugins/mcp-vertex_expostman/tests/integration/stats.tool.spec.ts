/**
 * El tool `stats`: el tamaño y la forma de la colección, en datos.
 *
 * Lo que se comprueba de fondo es que **los números cuadran solos**: el
 * total tiene que ser la suma de los métodos y también la de las zonas.
 * Un desglose que no suma su propio total es la clase de dato que un
 * agente usa para decidir mal sin enterarse.
 *
 * Y que sale en datos y no en la tabla que imprime el CLI, que alinea
 * con `padEnd` según el nombre de carpeta más largo — o sea que el ancho
 * de columna cambia entre proyectos.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildStatsToolRegistration } from "../../src/lib/tools/stats.tool";
import { captureHandler, makeContext, workspaceRoot } from "../helpers/plugin-context";

const RAIZ = workspaceRoot(import.meta.url);

let work = "";
let proyecto = "";

/** El CLI de verdad, por subproceso: vitest corre en workers de Node. */
function cli(args: readonly string[]): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(
      "bun",
      ["run", join(RAIZ, "packages/cli/cli.script.ts"), ...args],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "stats-tool-"));
  proyecto = join(work, "api");
  await cp(join(RAIZ, "examples/example-express"), proyecto, { recursive: true });
  await rm(join(proyecto, "export-to-postman"), { recursive: true, force: true });
  await cli(["generate", "--project-root", proyecto]);
}, 180_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

interface IZona {
  zone: string;
  total: number;
  byFolder: Array<{ folder: string; count: number }>;
}

async function stats(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const handler = await captureHandler(
    buildStatsToolRegistration(makeContext({ workspaceRoot: RAIZ })),
  );
  const result = await handler(input);
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("las cifras de la colección", () => {
  test("devuelve el total, que no es cero", { timeout: 120_000 }, async () => {
    const out = await stats({ projectRoot: proyecto });
    expect(out["ok"]).toBe(true);
    expect(out["total"]).toBeGreaterThan(0);
  });

  /** EL test: un desglose que no suma su propio total no vale de nada. */
  test("el desglose por método suma el total", { timeout: 120_000 }, async () => {
    const out = await stats({ projectRoot: proyecto });
    const porMetodo = out["byMethod"] as Array<{ method: string; count: number }>;
    const suma = porMetodo.reduce((a, m) => a + m.count, 0);
    expect(suma).toBe(out["total"]);
  });

  test("el desglose por zona también suma el total", { timeout: 120_000 }, async () => {
    const out = await stats({ projectRoot: proyecto });
    const zonas = out["zones"] as IZona[];
    expect(zonas.reduce((a, z) => a + z.total, 0)).toBe(out["total"]);
  });

  test("y dentro de cada zona, las carpetas suman la zona", { timeout: 120_000 }, async () => {
    const out = await stats({ projectRoot: proyecto });
    for (const zona of out["zones"] as IZona[]) {
      expect(zona.byFolder.reduce((a, f) => a + f.count, 0)).toBe(zona.total);
    }
  });

  test("los métodos vienen de mayor a menor, como se imprimen", { timeout: 120_000 }, async () => {
    const out = await stats({ projectRoot: proyecto });
    const cuentas = (out["byMethod"] as Array<{ count: number }>).map((m) => m.count);
    expect([...cuentas].sort((a, b) => b - a)).toEqual(cuentas);
  });

  /**
   * Un proyecto sin configuración de zonas tiene una sola, la de por
   * defecto. Que aparezca —y no una lista vacía— es lo que hace que el
   * dato sea interpretable sin conocer la configuración.
   */
  test("sin configuración de zonas, aparece la de por defecto", { timeout: 120_000 }, async () => {
    const out = await stats({ projectRoot: proyecto });
    const zonas = out["zones"] as IZona[];
    expect(zonas.length).toBeGreaterThan(0);
    expect(zonas.every((z) => z.total > 0)).toBe(true);
  });
});

describe("lo que no puede hacer, lo dice", () => {
  test("un projectRoot que no existe da error con salida", async () => {
    const handler = await captureHandler(
      buildStatsToolRegistration(makeContext({ workspaceRoot: RAIZ })),
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
      buildStatsToolRegistration(makeContext({ workspaceRoot: RAIZ })),
    );
    const result = await handler({ projectRoot: vacio });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? "").toContain("generate");
  });
});
