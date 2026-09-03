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

import { handleUiRequest } from "../../packages/ui/server/ui-routes.service";
import type { IProjectSummary } from "../../packages/contracts/interfaces/core/domain.interface";
import type { IUiDeps } from "../../packages/contracts/interfaces/cli/ui.interface";

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
  evidence: [],
};

/** Dobles que registran con qué se les llamó. */
function deps(overrides: Partial<IUiDeps> = {}): IUiDeps & {
  readonly generado: Array<Record<string, unknown>>;
} {
  const generado: Array<Record<string, unknown>> = [];
  const guardados: Record<string, unknown> = {};
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
    // Los ajustes del doble viven en memoria: probar las rutas no
    // debería tocar el disco de nadie.
    readSettings: async () => ({ settings: { version: 1, ...guardados }, problem: null }),
    patchSettings: async (cambios) => {
      Object.assign(guardados, cambios);
      return { version: 1, ...guardados };
    },
    browse: async (path) => ({
      ok: true,
      path: path ?? "/casa",
      parent: "/",
      entries: [{ name: "api", path: "/casa/api", readable: true }],
      truncated: false,
    }),
    dryRun: async ({ outputDir }) => ({
      ok: true,
      outputDir: outputDir ?? "/x/export-to-postman",
      projectName: "sample-express",
      framework: "express",
      requests: 9,
      files: [
        {
          path: `${outputDir ?? "/x/export-to-postman"}/sample-express.postman_collection.json`,
          kind: "collection" as const,
          format: "postman",
          overwrites: false,
        },
      ],
      overwrites: 0,
      warnings: [],
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

/**
 * Los ajustes que sobreviven al cierre.
 *
 * No hay botón de guardar: la interfaz llama al guardar en cuanto se
 * toca un control. Un botón se olvida, y entonces el ajuste que alguien
 * cambió no está la próxima vez — que es justo lo que unos ajustes
 * persistentes vienen a evitar.
 */
describe("/api/settings", () => {
  test("devuelve lo guardado", async () => {
    const d = deps();
    await handleUiRequest("/api/settings/save", { locale: "es" }, d);
    const r = await handleUiRequest("/api/settings", {}, d);

    expect(r.status).toBe(200);
    expect((cuerpo(r)["settings"] as { locale: string }).locale).toBe("es");
  });

  test("guardar uno conserva los demás", async () => {
    const d = deps();
    await handleUiRequest("/api/settings/save", { locale: "es", theme: "dark" }, d);
    await handleUiRequest("/api/settings/save", { theme: "light" }, d);
    const r = await handleUiRequest("/api/settings", {}, d);

    const s = cuerpo(r)["settings"] as { locale: string; theme: string };
    expect(s.theme).toBe("light");
    expect(s.locale).toBe("es");
  });

  /**
   * Un cuerpo sin nada reconocible es un error y no un guardado vacío:
   * devolver `ok` sin haber guardado nada deja a quien llama creyendo
   * que su ajuste está.
   */
  test("un guardado sin nada reconocible se rechaza", async () => {
    const r = await handleUiRequest("/api/settings/save", { inventado: "x" }, deps());
    expect(r.status).toBe(400);
    const error = cuerpo(r)["error"] as { nextAction: string };
    expect(error.nextAction).toContain("locale");
  });

  /**
   * El motivo por el que no se pudieron leer los guardados viaja a la
   * interfaz, no a un log del servidor: unos ajustes que desaparecen sin
   * explicación parecen un fallo del programa.
   */
  test("un problema al leerlos llega a la interfaz", async () => {
    const r = await handleUiRequest(
      "/api/settings",
      {},
      deps({
        readSettings: async () => ({
          settings: { version: 1 },
          problem: "the settings file is not valid JSON",
        }),
      }),
    );
    expect(cuerpo(r)["problem"]).toContain("not valid JSON");
  });
});

/**
 * Elegir carpeta explorando, no escribiéndola: es donde más se falla,
 * porque una errata devuelve «no existe» y no queda pista de dónde
 * estabas.
 */
describe("/api/browse", () => {
  test("lista las carpetas de una ruta", async () => {
    const r = await handleUiRequest("/api/browse", { path: "/casa" }, deps());
    expect(r.status).toBe(200);
    const entries = cuerpo(r)["entries"] as Array<{ name: string }>;
    expect(entries[0]?.name).toBe("api");
  });

  /**
   * Una carpeta sin permiso es una respuesta legítima del explorador, no
   * un fallo de la ruta: se devuelve tal cual, con su `ok: false`, para
   * que la interfaz lo enseñe en vez de tratarlo como una caída.
   */
  test("una carpeta ilegible se devuelve tal cual, no como error HTTP", async () => {
    const r = await handleUiRequest(
      "/api/browse",
      { path: "/root" },
      deps({
        browse: async () => ({
          ok: false,
          path: "/root",
          parent: "/",
          entries: [],
          truncated: false,
          reason: "could not be read",
        }),
      }),
    );
    expect(r.status).toBe(200);
    expect(cuerpo(r)["ok"]).toBe(false);
    expect(cuerpo(r)["reason"]).toContain("could not be read");
  });
});

/**
 * El ensayo: enseña qué saldría **sin escribir nada**.
 */
describe("/api/dry-run", () => {
  test("devuelve el plan con los ficheros y las requests", async () => {
    const r = await handleUiRequest("/api/dry-run", { projectRoot: "/x" }, deps());
    expect(r.status).toBe(200);
    const plan = cuerpo(r)["plan"] as { requests: number; files: unknown[] };
    expect(plan.requests).toBe(9);
    expect(plan.files).toHaveLength(1);
  });

  /** Y no genera: es un ensayo. */
  test("ensayar no escribe nada", async () => {
    const d = deps();
    await handleUiRequest("/api/dry-run", { projectRoot: "/x" }, d);
    expect(d.generado).toEqual([]);
  });

  test("sin carpeta lo dice y explica qué elegir", async () => {
    const r = await handleUiRequest("/api/dry-run", {}, deps());
    expect(r.status).toBe(400);
    const error = cuerpo(r)["error"] as { nextAction: string };
    expect(error.nextAction).toContain("project root");
  });

  test("una carpeta que no existe da 404", async () => {
    const r = await handleUiRequest(
      "/api/dry-run",
      { projectRoot: "/no/existe" },
      deps({ exists: async () => false }),
    );
    expect(r.status).toBe(404);
  });

  /**
   * Un plan inválido es un 400: se ha pedido algo imposible, no ha
   * fallado el ensayo.
   */
  test("un formato inventado invalida el plan con salida", async () => {
    const r = await handleUiRequest(
      "/api/dry-run",
      { projectRoot: "/x", formats: ["inventado"] },
      deps({
        dryRun: async () => ({
          ok: false,
          outputDir: "/x",
          projectName: "x",
          framework: null,
          requests: 0,
          files: [],
          overwrites: 0,
          warnings: [],
          reason: "Unknown formats: inventado.",
        }),
      }),
    );
    expect(r.status).toBe(400);
    const error = cuerpo(r)["error"] as { reason: string; nextAction: string };
    expect(error.reason).toContain("inventado");
    expect(error.nextAction.length).toBeGreaterThan(0);
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

  /**
   * La autodetección no puede acertar siempre —monorepos, dependencias
   * con alias—. Forzar el framework en la interfaz apoya a quien la
   * detección deja fuera, y la lista viene del catálogo, no de una
   * segunda fuente.
   */
  test("un framework del catálogo se pasa al pipeline tal cual", async () => {
    const d = deps();
    const r = await handleUiRequest(
      "/api/generate",
      { projectRoot: "/x", framework: "laravel" },
      d,
    );
    expect(r.status).toBe(200);
    expect(d.generado[0]).toMatchObject({ projectRoot: "/x", framework: "laravel" });
  });

  test("un framework inventado se rechaza con la lista del catálogo", async () => {
    const d = deps();
    const r = await handleUiRequest(
      "/api/generate",
      { projectRoot: "/x", framework: "inventado" },
      d,
    );
    expect(r.status).toBe(400);
    expect(d.generado).toEqual([]);
    const error = cuerpo(r)["error"] as { nextAction: string };
    expect(error.nextAction).toContain("laravel");
  });

  /**
   * Escribir fuera del proyecto es un uso legítimo —recoger varias
   * colecciones en un sitio—. Lo que no puede pasar desapercibido: la
   * respuesta dicen dónde quedó la colección cuando el destino no es el
   * de dentro del proyecto.
   */
  test("un destino fuera del proyecto se acepta y se anuncia", async () => {
    const r = await handleUiRequest(
      "/api/generate",
      { projectRoot: "/x", outputDir: "/otro/sitio" },
      deps(),
    );
    expect(r.status).toBe(200);
    const aviso = cuerpo(r)["notice"] as string;
    // El aviso señala la colección real, que es lo que la persona venir
    // a buscar.
    expect(aviso).toContain("outside the project");
    expect(aviso).toContain(".postman_collection.json");
  });

  test("el destino por defecto, dentro del proyecto, no genera aviso", async () => {
    const r = await handleUiRequest(
      "/api/generate",
      { projectRoot: "/x", outputDir: "/x/export-to-postman" },
      deps(),
    );
    expect(r.status).toBe(200);
    expect(cuerpo(r)["notice"]).toBeUndefined();
  });

  /**
   * `bruno` es el formato nativo de otro producto. Postman no lo
   * importa; ofrecerlo como equivalente engañaría a quien elige con la
   * expectativa de reimportar ahí.
   */
  test("capabilities distingue lo que Postman importa de lo que no", async () => {
    const r = await handleUiRequest("/api/capabilities", {}, deps());
    expect(r.status).toBe(200);
    expect(cuerpo(r)["formats"]).toContain("bruno");
    const importables = cuerpo(r)["postmanImportable"] as string[];
    expect(importables).not.toContain("bruno");
    expect(importables).toContain("postman");
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
