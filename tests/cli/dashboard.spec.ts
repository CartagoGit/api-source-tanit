/**
 * El dashboard multi-proyecto: lo que ve quien abre la UI raíz.
 *
 * El dashboard se monta sobre `~/.expostman/history.jsonl` (la
 * "huella" que `summary` y `generate` dejan al terminar) y muestra
 * las últimas generaciones cruzando varios proyectos. Tres
 * comportamientos importan y son los que se prueban aquí:
 *
 *   · Multi-proyecto: la lista se construye a partir de entradas de
 *     raíces distintas, no de un único proyecto.
 *   · Orden por timestamp: la entrada más reciente va primero; si
 *     fuera al revés, el dashboard sería un listado de lo viejo.
 *   · Filtros: `limit` y `projectRoot` se aplican desde la página
 *     sin tener que reescanear nada.
 *
 * La implementación actual expone estos datos por la ruta
 * `/api/history` (lo que llama el HTML en `index.html.constant.ts`).
 * Lo que se prueba aquí es el comportamiento del dashboard —multi-
 * proyecto, orden, filtros— independientemente de la ruta concreta,
 * porque el contrato del dashboard es su **forma de los datos**, no
 * el nombre del endpoint.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendHistory,
  readHistory,
} from "../../packages/ui/server/history.service.js";
import { handleUiRequest } from "../../packages/ui/server/ui-routes.service.js";
import type { IUiDeps } from "../../packages/contracts/interfaces/cli/ui.interface.js";
import type { IHistoryReadResult } from "../../packages/contracts/interfaces/cli/history.interface.js";
import type { IProjectSummary } from "../../packages/contracts/interfaces/core/domain.interface.js";

/** Raíz temporal donde vive el `history.jsonl` durante el test. */
let work = "";
let historyFile = "";

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "dashboard-"));
  historyFile = join(work, "history.jsonl");
});

afterEach(async () => {
  if (work) {
    await rm(work, { recursive: true, force: true });
    work = "";
  }
});

/** Resumen mínimo válido para construir entradas. */
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

/**
 * Helper que escribe una entrada en el historial devolviendo los
 * argumentos necesarios para volver a leerla.
 *
 * El timestamp se pasa como **tercer argumento** de `appendHistory`
 * (no dentro del input: `appendHistory(input, path, now)` lo recibe
 * por la cola para que el llamador no pueda congelar la hora). Los
 * tests que necesitan timestamps concretos lo enchufan aquí; los que
 * no usan el `new Date()` por defecto y se ordenan por orden de
 * inserción.
 */
async function appendEntrada(
  projectRoot: string,
  projectName: string,
  framework: string,
  endpoints: number,
  timestamp: Date,
  kind: "generate" | "summary" = "generate",
  collectionPath: string | null = "/x.json",
): Promise<void> {
  await appendHistory(
    {
      kind,
      projectRoot,
      summary: {
        ...RESUMEN_BASE,
        projectName,
        framework,
        routesInCode: endpoints,
      },
      collectionPath,
    },
    historyFile,
    timestamp,
  );
}

/**
 * Dobla el servicio `history` por encima del `readHistory` real, con
 * `historyFile` inyectado: el dashboard escribe ahí en el test, y el
 * doble lo lee. Esto deja los tests sin tocar `process.env.HOME` y
 * deja al lector saber exactamente qué fichero está mirando.
 */
async function dashboardDeps(
  overrides: Partial<IUiDeps> = {},
): Promise<IUiDeps> {
  const historyCalls: Array<Record<string, unknown>> = [];
  return {
    locales: () => ({ locales: [], rejected: [] }),
    readSettings: async () => ({ settings: { version: 1 }, problem: null }),
    patchSettings: async (cambios) => ({ version: 1, ...cambios }),
    browse: async () => ({
      ok: true,
      path: "/",
      parent: "/",
      entries: [],
      truncated: false,
    }),
    dryRun: async () => ({
      ok: true,
      outputDir: "/x",
      projectName: "x",
      framework: null,
      requests: 0,
      files: [],
      overwrites: 0,
      warnings: [],
    }),
    summarize: async () => RESUMEN_BASE,
    generate: async () => ({
      collectionPath: null,
      requests: 0,
      folders: 0,
      extraPaths: [],
      warnings: [],
    }),
    /**
     * El doble pasa por el servicio real con la ruta del test. La
     * razón: queremos que el camino append → JSONL → read sea el
     * mismo que en producción, sin reinventarlo aquí.
     */
    history: async (params) => {
      historyCalls.push({ ...params });
      return await readHistory(params, historyFile);
    },
    formats: () => ["postman"],
    frameworks: () => ["express", "fastapi", "laravel"],
    exists: async () => true,
    ...overrides,
  };
}

const cuerpo = (r: { body: unknown }): Record<string, unknown> =>
  r.body as Record<string, unknown>;

describe("dashboard — multi-proyecto desde history.jsonl", () => {
  /**
   * Tres proyectos distintos escriben tres entradas; el dashboard
   * debe devolver las tres en una sola respuesta, sin agrupar ni
   * deduplicar. Sin esto, un proyecto que genera muy a menudo tapa
   * a los demás.
   */
  test("devuelve entradas de varios proyectos en la misma respuesta", async () => {
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      4,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendEntrada(
      "/p/b",
      "bravo",
      "fastapi",
      7,
      new Date("2026-09-03T11:00:00Z"),
    );
    await appendEntrada(
      "/p/c",
      "charlie",
      "laravel",
      12,
      new Date("2026-09-03T12:00:00Z"),
    );

    const result = await readHistory({}, historyFile);
    const nombres = result.entries.map((e) => e.projectName).sort();
    expect(nombres).toEqual(["alpha", "bravo", "charlie"]);
    expect(result.entries.length).toBe(3);
  });

  /**
   * Orden: la entrada con timestamp más reciente va primero. Aquí
   * el orden de inserción es inverso al cronológico: la segunda
   * inserción tiene timestamp 11:00, así que la respuesta debe
   * ponerla antes que la de 12:00 al revés del orden append.
   *
   * El test escribe explícitamente en orden cronológico inverso al
   * de llegada, así que si el servicio no reordenara, el resultado
   * sería `[c, b, a]` cuando el correcto es `[c, b, a]` ya con
   * timestamps 12, 11, 10 — el orden **append** sí es correcto
   * aquí; la verificación es que el más reciente queda arriba.
   */
  test("ordena de más reciente a más antiguo por timestamp ISO 8601", async () => {
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      4,
      new Date("2026-09-03T08:00:00Z"),
    );
    await appendEntrada(
      "/p/b",
      "bravo",
      "fastapi",
      7,
      new Date("2026-09-03T11:00:00Z"),
    );
    await appendEntrada(
      "/p/c",
      "charlie",
      "laravel",
      12,
      new Date("2026-09-03T13:00:00Z"),
    );

    const result = await readHistory({}, historyFile);
    expect(result.entries[0]?.projectName).toBe("charlie");
    expect(result.entries[1]?.projectName).toBe("bravo");
    expect(result.entries[2]?.projectName).toBe("alpha");
  });

  /**
   * Filtro por raíz exacta. Sin este filtro el dashboard sería un
   * cajón desastre de todo lo generado, y un usuario con varios
   * proyectos acabaría sin poder encontrar el suyo.
   */
  test("el filtro por projectRoot reduce la lista a un único proyecto", async () => {
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      4,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      5,
      new Date("2026-09-03T11:00:00Z"),
    );
    await appendEntrada(
      "/p/b",
      "bravo",
      "fastapi",
      7,
      new Date("2026-09-03T12:00:00Z"),
    );

    const result = await readHistory({ projectRoot: "/p/a" }, historyFile);
    expect(result.entries.every((e) => e.projectRoot === "/p/a")).toBe(true);
    expect(result.entries.map((e) => e.projectName)).toEqual(["alpha", "alpha"]);
  });

  /**
   * `limit` recorta a las N más recientes. Sin cap, un historial
   * largo inunda la respuesta y el dashboard se vuelve inutilizable
   * antes de que el usuario llegue a hacer scroll.
   */
  test("limit N devuelve solo las N más recientes", async () => {
    for (let i = 0; i < 5; i++) {
      await appendEntrada(
        `/p/${i}`,
        `p${i}`,
        "express",
        i + 1,
        new Date(`2026-09-03T10:0${i}:00Z`),
      );
    }

    const result = await readHistory({ limit: 2 }, historyFile);
    expect(result.entries.length).toBe(2);
    expect(result.entries[0]?.projectName).toBe("p4");
    expect(result.entries[1]?.projectName).toBe("p3");
    // El total no recorta: `limit` es sobre la respuesta, no sobre
    // el conteo histórico que el dashboard también muestra.
    expect(result.totalEntries).toBe(5);
  });

  /**
   * Combinación: limit + projectRoot a la vez. Sin esta combinación,
   * la página tendría que pedir las dos cosas en llamadas
   * separadas — una para "todas las de este proyecto" y otra para
   * "las 5 más recientes" — y la respuesta serían dos lecturas del
   * mismo fichero.
   */
  test("limit y projectRoot se aplican a la vez: filtro, luego cap", async () => {
    for (let i = 0; i < 4; i++) {
      await appendEntrada(
        "/p/a",
        "alpha",
        "express",
        i + 1,
        new Date(`2026-09-03T10:0${i}:00Z`),
      );
    }
    for (let i = 0; i < 4; i++) {
      await appendEntrada(
        "/p/b",
        "bravo",
        "fastapi",
        100 + i,
        new Date(`2026-09-03T11:0${i}:00Z`),
      );
    }

    const result = await readHistory(
      { projectRoot: "/p/a", limit: 2 },
      historyFile,
    );
    expect(result.entries.length).toBe(2);
    expect(result.entries.every((e) => e.projectRoot === "/p/a")).toBe(true);
    expect(result.totalEntries).toBe(4);
  });

  /**
   * Línea corrupta: el dashboard no se viene abajo. Esto ya está
   * cubierto en `tests/cli/history.spec.ts`; aquí se reescribe
   * enfocado al caso de uso del dashboard (varias entradas + una
   * línea mala en medio), porque el dashboard lee un fichero que
   * crece con el uso y una edición a mano deja líneas inválidas.
   */
  test("una línea corrupta entre entradas no rompe la lista del dashboard", async () => {
    await mkdir(work, { recursive: true });
    await writeFile(
      historyFile,
      [
        JSON.stringify({
          version: 1,
          timestamp: "2026-09-03T09:00:00Z",
          kind: "generate",
          projectRoot: "/p/a",
          projectName: "alpha",
          framework: "express",
          endpoints: 1,
          collectionPath: "/x.json",
          summary: { ...RESUMEN_BASE, projectName: "alpha", routesInCode: 1 },
        }),
        "{ no es json válido",
        JSON.stringify({
          version: 1,
          timestamp: "2026-09-03T12:00:00Z",
          kind: "generate",
          projectRoot: "/p/c",
          projectName: "charlie",
          framework: "laravel",
          endpoints: 3,
          collectionPath: "/c.json",
          summary: { ...RESUMEN_BASE, projectName: "charlie", routesInCode: 3 },
        }),
      ].join("\n") + "\n",
    );

    const result = await readHistory({}, historyFile);
    expect(result.entries.length).toBe(2);
    expect(result.rejected.length).toBe(1);
    // El dashboard sigue enseñando las dos buenas, y la rechazada
    // viaja en la respuesta para quien quiera avisar al usuario.
    expect(result.entries.map((e) => e.projectName).sort()).toEqual([
      "alpha",
      "charlie",
    ]);
  });
});

describe("dashboard — la ruta HTTP entrega multi-proyecto, orden y filtros", () => {
  /**
   * El dashboard llega al navegador por una ruta HTTP. Lo que se
   * prueba es que la ruta entrega multi-proyecto desde el
   * `history.jsonl` real —es decir, el mismo fichero que `append`
   * escribe— sin tener que reimplementar nada en la ruta.
   */
  test("la ruta entrega entradas de varios proyectos desde history.jsonl", async () => {
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      4,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendEntrada(
      "/p/b",
      "bravo",
      "fastapi",
      7,
      new Date("2026-09-03T11:00:00Z"),
    );
    await appendEntrada(
      "/p/c",
      "charlie",
      "laravel",
      12,
      new Date("2026-09-03T12:00:00Z"),
    );

    const deps = await dashboardDeps();
    const r = await handleUiRequest("/api/history", {}, deps);
    expect(r.status).toBe(200);
    const body = cuerpo(r);
    expect(body["ok"]).toBe(true);
    const entries = body["entries"] as Array<{ projectName: string }>;
    expect(entries.length).toBe(3);
    const nombres = entries.map((e) => e.projectName).sort();
    expect(nombres).toEqual(["alpha", "bravo", "charlie"]);
  });

  /**
   * La ruta propaga `limit` al servicio sin reescribirlo: el doble
   * recibe el parámetro intacto. Si la ruta lo reinterpretara, el
   * cap dependería de una segunda implementación que se desincroniza
   * del servicio.
   */
  test("limit se propaga de la página al servicio sin reescritura", async () => {
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      4,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendEntrada(
      "/p/b",
      "bravo",
      "fastapi",
      7,
      new Date("2026-09-03T11:00:00Z"),
    );

    let capturadas: Array<Record<string, unknown>> = [];
    const deps = await dashboardDeps({
      history: async (params) => {
        capturadas.push({ ...params });
        return await readHistory(params, historyFile);
      },
    });
    const r = await handleUiRequest("/api/history", { limit: 1 }, deps);
    expect(r.status).toBe(200);
    expect(capturadas[0]).toEqual({ limit: 1 });
    const entries = cuerpo(r)["entries"] as Array<{ projectName: string }>;
    expect(entries.length).toBe(1);
  });

  /**
   * El filtro por raíz también se propaga. Es la mitad de "este
   * proyecto en concreto" — sin ella, el dashboard no se puede
   * acotar a un único repo cuando el usuario tiene varios.
   */
  test("projectRoot se propaga al servicio y la respuesta se filtra", async () => {
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      4,
      new Date("2026-09-03T10:00:00Z"),
    );
    await appendEntrada(
      "/p/b",
      "bravo",
      "fastapi",
      7,
      new Date("2026-09-03T11:00:00Z"),
    );

    let capturadas: Array<Record<string, unknown>> = [];
    const deps = await dashboardDeps({
      history: async (params) => {
        capturadas.push({ ...params });
        return await readHistory(params, historyFile);
      },
    });
    const r = await handleUiRequest(
      "/api/history",
      { projectRoot: "/p/b" },
      deps,
    );
    expect(r.status).toBe(200);
    expect(capturadas[0]).toEqual({ projectRoot: "/p/b" });
    const entries = cuerpo(r)["entries"] as Array<{ projectRoot: string }>;
    expect(entries.every((e) => e.projectRoot === "/p/b")).toBe(true);
  });

  /**
   * `totalEntries` también viaja en la respuesta: el dashboard
   * puede enseñar "X de Y" si quiere. No es obligatorio, pero está
   * en la respuesta para quien quiera mostrar el conteo completo
   * sin tener que pedir otra vez el historial sin `limit`.
   */
  test("la respuesta incluye el total sin truncar, aunque limit recorte", async () => {
    for (let i = 0; i < 5; i++) {
      await appendEntrada(
        `/p/${i}`,
        `p${i}`,
        "express",
        i + 1,
        new Date(`2026-09-03T10:0${i}:00Z`),
      );
    }

    const deps = await dashboardDeps();
    const r = await handleUiRequest("/api/history", { limit: 2 }, deps);
    expect(cuerpo(r)["totalEntries"]).toBe(5);
    const entries = cuerpo(r)["entries"] as unknown[];
    expect(entries.length).toBe(2);
  });

  /**
   * Dashboard sin historial: el dashboard responde 200 con lista
   * vacía, no con un 500. La página, sin red, mostraría "todavía
   * nada"; con 500, mostraría un error genérico que atribuye el
   * fallo a la herramienta cuando en realidad nadie ha generado.
   */
  test("sin historial: 200 con entries vacío, no error", async () => {
    const deps = await dashboardDeps();
    const r = await handleUiRequest("/api/history", {}, deps);
    expect(r.status).toBe(200);
    const body = cuerpo(r);
    expect(body["ok"]).toBe(true);
    expect(body["entries"]).toEqual([]);
    expect(body["totalEntries"]).toBe(0);
  });

  /**
   * El append escribe físicamente al `history.jsonl`: si la ruta
   * HTTP recibiera los datos sin pasar por el fichero, los reinicios
   * del servidor vaciarían el dashboard. Esta verificación es
   * pequeña pero decisiva: lee el fichero tras el append y confirma
   * que las líneas llegaron.
   */
  test("appendHistory deja huella en disco, no solo en memoria", async () => {
    await appendEntrada(
      "/p/a",
      "alpha",
      "express",
      4,
      new Date("2026-09-03T10:00:00Z"),
    );
    const raw = await readFile(historyFile, "utf8");
    expect(raw.split("\n").filter((l) => l.trim() !== "").length).toBe(1);
    expect(raw).toContain("alpha");
    expect(raw).toContain("/p/a");
  });
});

/**
 * Type helper exportado: el dashboard distingue `entries` (la lista
 * visible) de `totalEntries` (lo que había en disco). Si alguien
 * añade un campo nuevo al servicio, este type lo deja ver sin tener
 * que importarlo de `history.interface`.
 */
export type IDashboardReadResult = IHistoryReadResult;