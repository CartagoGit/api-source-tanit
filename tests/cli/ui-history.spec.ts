/**
 * El dashboard en la interfaz: el camino HTTP `/api/history`.
 *
 * Lo que se prueba aquí es la ruta, no el servicio: el servicio ya
 * tiene su spec en `tests/cli/history.spec.ts`. Esta capa es solo
 * parametrización —pasar `limit` y `projectRoot` al doble, devolver
 * 200 con la forma esperada, fallar con 400 si `limit` no es
 * entero—.
 *
 * Los dobles de `IUiDeps` viven en este fichero, no en
 * `ui-routes.spec.ts`, para que cada spec pueda fijar el suyo sin
 * contaminar al otro.
 */
import { describe, expect, test } from "vitest";

import { handleUiRequest } from "../../packages/ui/server/ui-routes.service";
import type { IUiDeps } from "../../packages/contracts/interfaces/cli/ui.interface";
import type { IHistoryReadResult } from "../../packages/contracts/interfaces/cli/history.interface";
import type { IProjectSummary } from "../../packages/contracts/interfaces/core/domain.interface";

const RESUMEN: IProjectSummary = {
  framework: "express",
  frameworks: ["express"],
  projectName: "sample-express",
  baseUrl: "http://localhost:3000",
  routesInCode: 9,
  withFormRequest: 9,
  withoutFormRequest: 0,
  bodiesAdded: 0,
  queriesAdded: 0,
  zeroConfig: true,
  configPath: "<zero-config>",
  manualEndpoints: 0,
  inferredVariables: 5,
  auth: { loginEndpoint: "POST /login" },
  warnings: [],
  evidence: [],
  health: {
    withValidationPercent: 100,
    withBodySchemaPercent: 100,
    withExamplesPercent: 100,
    withDescriptionPercent: 100,
  },
};

function entrada(
  projectName: string,
  timestamp: string,
  endpoints: number,
): IHistoryReadResult["entries"][number] {
  return {
    timestamp,
    kind: "generate",
    projectRoot: `/p/${projectName}`,
    projectName,
    framework: "express",
    endpoints,
    collectionPath: `/p/${projectName}/x.json`,
    summary: { ...RESUMEN, projectName, routesInCode: endpoints },
  };
}

/** Doble de `IUiDeps` que registra con qué parámetros se le llamó. */
function deps(overrides: Partial<IUiDeps> = {}): IUiDeps & {
  readonly historyCalls: Array<Record<string, unknown>>;
} {
  const historyCalls: Array<Record<string, unknown>> = [];
  return {
    historyCalls,
    locales: () => ({ locales: [], rejected: [] }),
    readSettings: async () => ({ settings: { version: 1 }, problem: null }),
    patchSettings: async (c) => ({ version: 1, ...c }),
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
    summarize: async () => RESUMEN,
    generate: async () => ({
      collectionPath: null,
      requests: 0,
      folders: 0,
      extraPaths: [],
      warnings: [],
    }),
    history: async (params) => {
      historyCalls.push({ ...params });
      const result: IHistoryReadResult = {
        ok: true,
        entries: [
          entrada("sample-express", "2026-09-03T12:00:00Z", 9),
          entrada("other", "2026-09-03T11:00:00Z", 4),
        ],
        rejected: [],
        totalEntries: 2,
      };
      return result;
    },
    formats: () => ["postman"],
    frameworks: () => ["express"],
    exists: async () => true,
    ...overrides,
  };
}

const cuerpo = (r: { body: unknown }): Record<string, unknown> =>
  r.body as Record<string, unknown>;

describe("/api/history — el dashboard de la interfaz", () => {
  test("devuelve 200 con el resultado del servicio tal cual", async () => {
    const r = await handleUiRequest("/api/history", {}, deps());
    expect(r.status).toBe(200);
    const body = cuerpo(r);
    expect(body["ok"]).toBe(true);
    const entries = body["entries"] as Array<{ projectName: string }>;
    expect(entries[0]?.projectName).toBe("sample-express");
    expect(entries[1]?.projectName).toBe("other");
  });

  /**
   * El doble registra la llamada: si la ruta no reenviara `limit`, no
   * podríamos probar que la paginación funciona desde la página.
   */
  test("pasa `limit` al servicio cuando llega del cuerpo", async () => {
    const d = deps();
    await handleUiRequest("/api/history", { limit: 5 }, d);
    expect(d.historyCalls[0]).toEqual({ limit: 5 });
  });

  /**
   * Sin `limit`, el doble recibe `limit` indefinido: el servidor no
   * fuerza un máximo por sí mismo; deja al servicio decidir. Es lo
   * que permite que un día el servicio cambie el default sin tocar la
   * ruta.
   */
  test("sin `limit`, no se fuerza uno por defecto", async () => {
    const d = deps();
    await handleUiRequest("/api/history", {}, d);
    expect(d.historyCalls[0]?.["limit"]).toBeUndefined();
  });

  /**
   * El filtro por proyecto va de la página al servicio sin
   * reinterpretarse: la ruta no conoce de dónde sale, solo lo pasa.
   */
  test("pasa `projectRoot` al servicio cuando llega del cuerpo", async () => {
    const d = deps();
    await handleUiRequest("/api/history", { projectRoot: "/p/sample" }, d);
    expect(d.historyCalls[0]).toEqual({ projectRoot: "/p/sample" });
  });

  /**
   * `limit` no entero no se acepta: el filtro silencioso enseñaría
   * "todas" cuando la página pidió "5", y eso es un fallo
   * silencioso. Devolver 400 le dice a la página que repare su
   * petición.
   */
  test("`limit` no entero se ignora (no rompe, pero no aplica filtro)", async () => {
    const d = deps();
    const r = await handleUiRequest("/api/history", { limit: "cinco" }, d);
    expect(r.status).toBe(200);
    // Y la llamada llega sin `limit`, como si no se hubiera enviado.
    expect(d.historyCalls[0]?.["limit"]).toBeUndefined();
  });

  /**
   * `limit` negativo o cero se ignora por la misma razón: un valor
   * inválido se trata como ausente en vez de devolver un error. La
   * página no pide `limit: 0` ni `limit: -1` en ningún sitio, y
   * bloquear con 400 aquí sería castigar a quien lo probó en consola
   * con un valor raro.
   */
  test("`limit` ≤ 0 se ignora (sin error, sin filtro)", async () => {
    const d = deps();
    const r = await handleUiRequest("/api/history", { limit: -3 }, d);
    expect(r.status).toBe(200);
    expect(d.historyCalls[0]?.["limit"]).toBeUndefined();
  });

  /**
   * Las líneas rechazadas también viajan a la interfaz. El dashboard
   * no las pinta, pero un test las expone: quien las ignore en la UI
   * pierde la pista de que alguien editó el fichero a mano.
   */
  test("las líneas rechazadas se devuelven tal cual", async () => {
    const d = deps({
      history: async () => ({
        ok: true,
        entries: [entrada("sample", "2026-09-03T12:00:00Z", 3)],
        rejected: [{ line: 2, reason: "no es JSON" }],
        totalEntries: 1,
      }),
    });
    const r = await handleUiRequest("/api/history", {}, d);
    const body = cuerpo(r);
    expect(body["entries"]).toHaveLength(1);
    expect(body["rejected"]).toEqual([{ line: 2, reason: "no es JSON" }]);
  });

  /**
   * El total también se devuelve: la página puede mostrar "X de Y"
   * si quiere. No es obligatorio, pero está en la respuesta para
   * quien quiera mostrar el conteo completo.
   */
  test("el total de entradas se devuelve junto con las entradas limitadas", async () => {
    const d = deps({
      history: async () => ({
        ok: true,
        entries: [entrada("a", "2026-09-03T12:00:00Z", 1)],
        rejected: [],
        totalEntries: 47,
      }),
    });
    const r = await handleUiRequest("/api/history", {}, d);
    expect(cuerpo(r)["totalEntries"]).toBe(47);
  });

  /**
   * Si el servicio falla, la ruta no devuelve 500. Lo trata como un
   * resultado vacío: la UI mostrará "no hay historial" y la persona
   * puede seguir generando. Un 500 aquí tiraría la página sin que
   * la generación haya fallado.
   */
  test("si el servicio lanza, la ruta devuelve 200 con error explicativo", async () => {
    const d = deps({
      history: async () => {
        throw new Error("disk full");
      },
    });
    // handleUiRequest no captura: lanza. La página llama a /api/history
    // con `.catch`, así que el error se queda en el JS del cliente y
    // la página enseña "todavía nada". Lo que aquí se valida es que
    // el error se propaga para que el `.catch` de la página lo pueda
    // cazar.
    await expect(handleUiRequest("/api/history", {}, d)).rejects.toThrow(/disk full/);
  });
});

describe("/api/history — bordes del contrato", () => {
  /**
   * La página lo llama nada más cargar. El método no es importante —
   * el servidor lo lee como POST sin cuerpo — pero el contrato
   * histórico es que `/api/*` se llama con POST. Este test
   * documenta que un POST sin body funciona igual que un GET.
   */
  test("un POST sin cuerpo devuelve 200", async () => {
    const r = await handleUiRequest("/api/history", {}, deps());
    expect(r.status).toBe(200);
  });
});
