/**
 * Lo que contesta la interfaz, sin levantar ningún puerto.
 *
 * Las rutas están separadas del transporte a propósito: son una función
 * de `(ruta, cuerpo)` a `(estado, datos)`, con sus colaboradores
 * inyectados. Por eso se pueden probar enteras aquí — incluidos los
 * casos que a mano son incómodos de provocar, como una carpeta que no
 * existe o un formato inventado.
 *
 * Lo que se comprueba de fondo es que **la interfaz no reimplementa
 * nada**: llama al mismo pipeline que el CLI. Una segunda
 * implementación es una que se desincroniza.
 */
import { describe, expect, test } from "vitest";

import { handleUiRequest } from "../../projects/ui/server/ui-routes.service";
import type { IProjectSummary } from "../../projects/contracts/interfaces/core/domain.interface";
import type { IUiDeps } from "../../projects/contracts/interfaces/cli/ui.interface";

const RESUMEN: IProjectSummary = {
  framework: "express",
  frameworks: ["express"],
  projectName: "sample-express",
  baseUrl: "http://localhost/api",
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
};

/** Dobles que registran con qué se les llamó. */
function deps(overrides: Partial<IUiDeps> = {}): IUiDeps & {
  readonly generado: Array<Record<string, unknown>>;
} {
  const generado: Array<Record<string, unknown>> = [];
  return {
    generado,
    locales: () => ({
      locales: [
        {
          code: "en",
          nativeName: "English",
          rtl: false,
          translations: { "nav.settings": "Settings" },
          origin: "bundled" as const,
        },
      ],
      rejected: [],
    }),
    summarize: async () => RESUMEN,
    generate: async (params) => {
      generado.push({ ...params });
      return {
        collectionPath: "/tmp/x/sample-express.postman_collection.json",
        requests: 9,
        folders: 3,
        extraPaths: [],
        warnings: [],
      };
    },
    formats: () => ["postman", "openapi", "insomnia", "bruno", "har", "curl"],
    frameworks: () => ["express", "laravel", "graphql"],
    exists: async () => true,
    ...overrides,
  };
}

const cuerpo = (r: { body: unknown }): Record<string, unknown> =>
  r.body as Record<string, unknown>;

/**
 * Los idiomas van por su propia ruta, y no en `/api/capabilities`,
 * porque cambian por otro motivo: los formatos y los frameworks son del
 * producto; los idiomas son de quien lo usa —puede añadir uno dejando
 * un fichero, y entonces esta respuesta cambia sin que el producto haya
 * cambiado—.
 */
describe("/api/locales", () => {
  test("devuelve los idiomas con su nombre nativo y sus textos", async () => {
    const r = await handleUiRequest("/api/locales", {}, deps());
    expect(r.status).toBe(200);
    const locales = cuerpo(r)["locales"] as Array<{ code: string; nativeName: string }>;
    expect(locales[0]?.code).toBe("en");
    expect(locales[0]?.nativeName).toBe("English");
  });

  /**
   * Los ficheros que alguien dejó y no se pudieron leer viajan en la
   * respuesta, no a un log del servidor: quien los escribió está
   * mirando la interfaz, no la terminal.
   */
  test("los idiomas rechazados llegan a la interfaz, no a un log", async () => {
    const r = await handleUiRequest(
      "/api/locales",
      {},
      deps({
        locales: () => ({
          locales: [],
          rejected: [{ file: "xx.json", reason: "is not valid JSON" }],
        }),
      }),
    );
    const rejected = cuerpo(r)["rejected"] as Array<{ file: string }>;
    expect(rejected[0]?.file).toBe("xx.json");
  });
});

describe("/api/capabilities", () => {
  test("dice qué formatos y frameworks hay, para que la interfaz se dibuje sola", async () => {
    const r = await handleUiRequest("/api/capabilities", {}, deps());
    expect(r.status).toBe(200);
    expect(cuerpo(r)["formats"]).toContain("openapi");
    expect(cuerpo(r)["frameworks"]).toContain("express");
  });
});

describe("/api/inspect — enseña antes de escribir", () => {
  test("devuelve el resumen del proyecto", async () => {
    const r = await handleUiRequest("/api/inspect", { projectRoot: "/x" }, deps());
    expect(r.status).toBe(200);
    expect((cuerpo(r)["summary"] as IProjectSummary).routesInCode).toBe(9);
  });

  test("sin carpeta, lo dice y explica qué elegir", async () => {
    const r = await handleUiRequest("/api/inspect", {}, deps());
    expect(r.status).toBe(400);
    const error = cuerpo(r)["error"] as { nextAction: string };
    expect(error.nextAction).toContain("raíz");
  });

  test("una carpeta que no existe da 404, no un fallo del servidor", async () => {
    const r = await handleUiRequest(
      "/api/inspect",
      { projectRoot: "/no/existe" },
      deps({ exists: async () => false }),
    );
    expect(r.status).toBe(404);
  });

  /**
   * Cero rutas no es un error: un proyecto que aún no tiene endpoints es
   * legítimo. Pero decirlo aquí evita generar una colección vacía y que
   * parezca que la herramienta falló.
   */
  test("cero rutas no es un error, es un aviso", async () => {
    const r = await handleUiRequest(
      "/api/inspect",
      { projectRoot: "/x" },
      deps({ summarize: async () => ({ ...RESUMEN, routesInCode: 0 }) }),
    );
    expect(r.status).toBe(200);
    expect(cuerpo(r)["notice"]).toBeDefined();
  });

  test("inspeccionar no genera nada", async () => {
    const d = deps();
    await handleUiRequest("/api/inspect", { projectRoot: "/x" }, d);
    expect(d.generado).toEqual([]);
  });
});

describe("/api/generate", () => {
  test("pasa la carpeta y los formatos al pipeline, sin reinterpretarlos", async () => {
    const d = deps();
    const r = await handleUiRequest(
      "/api/generate",
      { projectRoot: "/x", outputDir: "/x/salida", formats: ["postman", "openapi"] },
      d,
    );
    expect(r.status).toBe(200);
    expect(d.generado[0]).toEqual({
      projectRoot: "/x",
      outputDir: "/x/salida",
      formats: ["postman", "openapi"],
    });
  });

  /**
   * El formato se valida **antes** de llamar al pipeline: fallar después
   * de haber empezado a escribir es como se dejan carpetas a medias.
   */
  test("un formato inventado se rechaza sin llegar a generar", async () => {
    const d = deps();
    const r = await handleUiRequest(
      "/api/generate",
      { projectRoot: "/x", formats: ["inventado"] },
      d,
    );
    expect(r.status).toBe(400);
    expect(d.generado).toEqual([]);
    const error = cuerpo(r)["error"] as { nextAction: string };
    // Y dice cuáles valen, que es lo accionable.
    expect(error.nextAction).toContain("postman");
  });

  test("sin formatos, el pipeline decide su defecto", async () => {
    const d = deps();
    await handleUiRequest("/api/generate", { projectRoot: "/x" }, d);
    expect(d.generado[0]).not.toHaveProperty("formats");
  });
});

describe("una ruta que no existe", () => {
  test("devuelve 404 y dice cuáles hay", async () => {
    const r = await handleUiRequest("/api/inventada", {}, deps());
    expect(r.status).toBe(404);
    const error = cuerpo(r)["error"] as { nextAction: string };
    expect(error.nextAction).toContain("/api/generate");
  });
});

describe("todos los errores son accionables", () => {
  /**
   * En una interfaz gráfica no hay `--help` a mano: un mensaje que dice
   * qué pasó y no qué hacer deja a la persona atascada delante de una
   * pantalla.
   */
  test.for([
    ["/api/inspect", {}],
    ["/api/generate", {}],
    ["/api/inventada", {}],
  ] as const)("%s lleva `nextAction`", async ([ruta, body]) => {
    const r = await handleUiRequest(ruta, body, deps());
    expect(r.status).toBeGreaterThanOrEqual(400);
    const error = cuerpo(r)["error"] as { reason: string; nextAction: string };
    expect(error.reason.length).toBeGreaterThan(0);
    expect(error.nextAction.length).toBeGreaterThan(0);
  });
});
