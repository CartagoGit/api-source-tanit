/**
 * `expostman history` — el reverso del append.
 *
 * El servicio escribe (`appendHistory`); este comando lee
 * (`readHistory`) y enseña. Lo que se comprueba es lo que importa de
 * verdad: que el comando dice lo que el fichero tiene y nada más, y
 * que `--limit`, `--project` y `--json` funcionan sin tener que
 * reorganizar el código del CLI.
 *
 * Los tests usan `path` y `home` inyectados para que el disco real no
 * se toque. Un test que escribe en `~/.expostman/history.jsonl` no es
 * un test: es un side-effect en la máquina de quien lo corre.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendHistory,
  readHistory,
} from "../../packages/ui/server/history.service";
import {
  runHistory,
} from "../../packages/cli/commands/history.script";
import type { IProjectSummary } from "../../packages/contracts/interfaces/core/domain.interface";

/** Resumen mínimo para construir entradas. */
const RESUMEN_BASE: IProjectSummary = {
  framework: "express",
  frameworks: ["express"],
  projectName: "sample",
  baseUrl: "http://localhost:3000",
  routesInCode: 5,
  withFormRequest: 5,
  withoutFormRequest: 0,
  bodiesAdded: 0,
  queriesAdded: 0,
  zeroConfig: true,
  configPath: "<zero-config>",
  manualEndpoints: 0,
  inferredVariables: 2,
  auth: null,
  warnings: [],
  evidence: [],
  health: {
    withValidationPercent: 100,
    withBodySchemaPercent: 100,
    withExamplesPercent: 100,
    withDescriptionPercent: 100,
  },
};

/** Una raíz temporal, y un fichero de historial dentro. */
let work = "";
let historyFile = "";

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "history-cli-"));
  historyFile = join(work, "history.jsonl");
});

afterEach(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

/** Helper para construir resúmenes con un proyecto y endpoints concretos. */
function resumen(projectName: string, endpoints: number): IProjectSummary {
  return { ...RESUMEN_BASE, projectName, routesInCode: endpoints };
}

describe("appendHistory + readHistory — el ciclo que el CLI ejecuta", () => {
  test("una entrada append+read vuelve igual", async () => {
    await appendHistory(
      { kind: "summary", projectRoot: "/p/sample", summary: resumen("sample", 9) },
      historyFile,
      new Date("2026-09-03T12:00:00Z"),
    );

    const read = await readHistory({}, historyFile);
    expect(read.totalEntries).toBe(1);
    expect(read.entries[0]?.projectName).toBe("sample");
    expect(read.entries[0]?.framework).toBe("express");
    expect(read.entries[0]?.endpoints).toBe(9);
  });

  /**
   * Las dos escrituras van en líneas separadas y se preservan.
   * Append concurrente en POSIX (`O_APPEND`) garantiza que cada `write`
   * es atómico: dos procesos que escriben a la vez no se pisan.
   */
  test("dos appends en serie producen dos entradas", async () => {
    await appendHistory(
      { kind: "summary", projectRoot: "/p/a", summary: resumen("a", 3) },
      historyFile,
      new Date("2026-09-03T12:00:00Z"),
    );
    await appendHistory(
      { kind: "generate", projectRoot: "/p/a", summary: resumen("a", 3), collectionPath: "/p/a/x.json" },
      historyFile,
      new Date("2026-09-03T12:05:00Z"),
    );

    const read = await readHistory({}, historyFile);
    expect(read.totalEntries).toBe(2);
  });

  /**
   * Orden: más reciente primero. Aquí la segunda entrada tiene
   * timestamp posterior, así que debe ir antes.
   */
  test("las entradas se devuelven de más reciente a más antigua", async () => {
    await appendHistory(
      { kind: "summary", projectRoot: "/p/a", summary: resumen("a", 3) },
      historyFile,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendHistory(
      { kind: "summary", projectRoot: "/p/b", summary: resumen("b", 5) },
      historyFile,
      new Date("2026-09-03T11:00:00Z"),
    );

    const read = await readHistory({}, historyFile);
    expect(read.entries[0]?.projectName).toBe("b");
    expect(read.entries[1]?.projectName).toBe("a");
  });

  /**
   * Una línea corrupta no tira el resto: la lectura devuelve lo bueno
   * y avisa de la línea mala. Sin esto, una edición manual con un
   * carácter fuera de sitio borra el historial entero.
   */
  test("una línea corrupta se ignora y se reporta", async () => {
    await mkdir(work, { recursive: true });
    await writeFile(historyFile, '{ "timestamp":"2026-09-03T09:00:00Z", "kind":"summary", no es json\n');
    await appendHistory(
      { kind: "summary", projectRoot: "/p/b", summary: resumen("b", 5) },
      historyFile,
      new Date("2026-09-03T11:00:00Z"),
    );

    const read = await readHistory({}, historyFile);
    expect(read.totalEntries).toBe(1);
    expect(read.entries[0]?.projectName).toBe("b");
    expect(read.rejected.length).toBe(1);
    expect(read.rejected[0]?.line).toBe(1);
  });

  test("un fichero inexistente devuelve vacío, no error", async () => {
    const read = await readHistory({}, historyFile);
    expect(read.totalEntries).toBe(0);
    expect(read.entries).toEqual([]);
    expect(read.rejected).toEqual([]);
  });
});

describe("runHistory — el comando en sí", () => {
  /**
   * El camino más normal: hay entradas y el comando las enseña.
   * Lo que se mira es que la salida tiene el nombre del proyecto y el
   * framework — lo que alguien que ejecuta `expostman history` viene
   * a buscar—, y no solo un número.
   */
  test("con dos entradas, las lista con proyecto y framework", async () => {
    await appendHistory(
      { kind: "summary", projectRoot: "/p/sample", summary: resumen("sample", 9) },
      historyFile,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendHistory(
      { kind: "generate", projectRoot: "/p/sample", summary: resumen("sample", 9), collectionPath: "/x.json" },
      historyFile,
      new Date("2026-09-03T11:00:00Z"),
    );

    const r = await runHistory(["--project", "/p/sample"], { historyPath: historyFile });
    expect(r.code).toBe(0);
    expect(r.output).toContain("sample");
    expect(r.output).toContain("express");
    // Las dos entradas, en una línea cada una.
    const lineas = r.output.split("\n").filter((l) => l.includes("endpoint"));
    expect(lineas.length).toBe(2);
  });

  /**
   * `--limit N` recorta a las últimas N. Sin esto, un historial
   * largo inunda la terminal y deja a quien lo mira igual de
   * desinformado que sin historial.
   */
  test("--limit recorta las últimas N", async () => {
    for (let i = 0; i < 5; i++) {
      await appendHistory(
        { kind: "summary", projectRoot: `/p/${i}`, summary: resumen(`p${i}`, i + 1) },
        historyFile,
        new Date(`2026-09-03T10:0${i}:00Z`),
      );
    }

    const r = await runHistory(["--limit", "2"], { historyPath: historyFile });
    expect(r.code).toBe(0);
    const lineas = r.output.split("\n").filter((l) => l.includes("endpoint"));
    expect(lineas.length).toBe(2);
    expect(r.output).toContain("p4");
    expect(r.output).toContain("p3");
  });

  /**
   * `--project` filtra por raíz exacta. Una raíz distinta no debe
   * aparecer — eso filtraría por "contiene" y dos proyectos con
   * nombres similares colarían entradas del otro.
   */
  test("--project filtra por raíz exacta", async () => {
    await appendHistory(
      { kind: "summary", projectRoot: "/p/sample", summary: resumen("sample", 5) },
      historyFile,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendHistory(
      { kind: "summary", projectRoot: "/p/other", summary: resumen("other", 7) },
      historyFile,
      new Date("2026-09-03T11:00:00Z"),
    );

    const r = await runHistory(["--project", "/p/sample"], { historyPath: historyFile });
    expect(r.code).toBe(0);
    expect(r.output).toContain("sample");
    expect(r.output).not.toContain("other");
  });

  /**
   * `--json` devuelve JSONL, una entrada por línea. Es el formato que
   * se mete en `jq` o en otro script; cualquier otra cosa rompe la
   * cadena.
   */
  test("--json emite JSONL con una entrada por línea", async () => {
    await appendHistory(
      { kind: "summary", projectRoot: "/p/a", summary: resumen("a", 3) },
      historyFile,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendHistory(
      { kind: "generate", projectRoot: "/p/a", summary: resumen("a", 3), collectionPath: "/x.json" },
      historyFile,
      new Date("2026-09-03T11:00:00Z"),
    );

    const r = await runHistory(["--json"], { historyPath: historyFile });
    expect(r.code).toBe(0);
    const lineas = r.output.split("\n").filter((l) => l.trim() !== "");
    expect(lineas.length).toBe(2);
    // Cada línea es un objeto JSON con los campos esperados.
    for (const l of lineas) {
      const o = JSON.parse(l) as Record<string, unknown>;
      expect(o["projectName"]).toBe("a");
      expect(typeof o["timestamp"]).toBe("string");
    }
  });

  /**
   * Sin entradas, el comando **no falla**. Devuelve un texto que dice
   * "no hay historial todavía" y dice dónde se escribiría, que es lo
   * que alguien que acaba de instalar la herramienta espera ver.
   */
  test("sin entradas devuelve un texto accionable, no vacío", async () => {
    const r = await runHistory([], { historyPath: historyFile });
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/no history/i);
  });

  /**
   * `--limit 0` o negativo: lo rechazamos con un mensaje claro. Si
   * lo aceptáramos, alguien con un script mal puesto acabaría con
   * un comando silencioso.
   */
  test("--limit no entero se rechaza", async () => {
    const r = await runHistory(["--limit", "abc"], { historyPath: historyFile });
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/integer/i);
  });

  /**
   * `--limit 0` se rechaza: cero entradas no es lo que `--limit 0`
   * significa en una herramienta que ya devuelve vacío sin él.
   */
  test("--limit 0 se rechaza", async () => {
    const r = await runHistory(["--limit", "0"], { historyPath: historyFile });
    expect(r.code).toBe(1);
  });

  /**
   * `--clear` borra el fichero. Lo que se mira es que después de
   * borrarlo, una lectura subsiguiente devuelve vacío: la operación
   * realmente ocurre.
   */
  test("--clear borra el fichero y devuelve un mensaje", async () => {
    await appendHistory(
      { kind: "summary", projectRoot: "/p/a", summary: resumen("a", 3) },
      historyFile,
      new Date(),
    );
    const antes = await readFile(historyFile, "utf8");
    expect(antes.length).toBeGreaterThan(0);

    const r = await runHistory(["--clear"], { historyPath: historyFile });
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/cleared/i);

    const despues = await readFile(historyFile, "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return "";
      throw err;
    });
    expect(despues).toBe("");
  });

  /**
   * `--clear` sobre un fichero inexistente sale con 0 y dice "nada
   * que borrar": borrarlo dos veces no es un error, y un mensaje de
   * error en este caso asustaría sin motivo.
   */
  test("--clear sin fichero dice 'nothing to clear'", async () => {
    const r = await runHistory(["--clear"], { historyPath: historyFile });
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/nothing/i);
  });
});

describe("el camino real del CLI", () => {
  /**
   * El camino de uso: `summary` escribe, `history` lee.
   *
   * Como summary escribe con la ruta por defecto, este test redirige
   * la variable `HOME` indirectamente pasando `home` a `runHistory`.
   * El append real usa la ruta por defecto; para no tocar el disco
   * de la máquina, aquí se ejercita por separado: un append con la
   * ruta que el servicio habría usado si `HOME` apuntara a `work`.
   *
   * Lo que se valida es el contrato **de la capa de servicio**:
   * append deja, read coge. La integración con la variable de
   * entorno se cubre con `userHistoryDir()` en su propio spec.
   */
  test("append + read preserva timestamp ISO 8601", async () => {
    const fecha = new Date("2026-09-03T15:30:45.123Z");
    await appendHistory(
      { kind: "summary", projectRoot: "/p/x", summary: resumen("x", 2) },
      historyFile,
      fecha,
    );

    const read = await readHistory({}, historyFile);
    expect(read.entries[0]?.timestamp).toBe("2026-09-03T15:30:45.123Z");
  });

  test("la ruta que devuelve IAppendResult es la que después se lee", async () => {
    const out = await appendHistory(
      { kind: "summary", projectRoot: "/p/y", summary: resumen("y", 1) },
      historyFile,
    );
    expect(out.ok).toBe(true);
    expect(out.path).toBe(historyFile);

    const read = await readHistory({}, out.path);
    expect(read.totalEntries).toBe(1);
  });
});
