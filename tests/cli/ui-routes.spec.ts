/**
 * What the interface answers, without bringing up any port.
 *
 * The routes are separated from the transport on purpose: they are a
 * function from `(route, body)` to `(status, data)`, with their
 * collaborators injected. That is why they can be tested entirely
 * here — including the cases that are awkward to provoke by hand,
 * like a folder that does not exist or a made-up format.
 *
 * What is checked in depth is that **the interface does not
 * reimplement anything**: it calls the same pipeline as the CLI.
 * A second implementation is one that drifts out of sync.
 */
import { describe, expect, test } from "vitest";

import { handleUiRequest } from "../../packages/ui/server/ui-routes.service";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
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
  health: {
    withValidationPercent: 100,
    withBodySchemaPercent: 100,
    withExamplesPercent: 100,
    withDescriptionPercent: 100,
  },
};

/** Doubles that record what they were called with. */
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
    // The double's settings live in memory: testing the routes
    // should not touch anyone's disk.
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
    /**
     * History double: empty by default. Tests that need concrete
     * entries override it via `overrides`.
     *
     * The signature matches `IUiDeps["history"]`: an object with
     * `limit?` and `projectRoot?`. Returning `ok: true` with
     * `entries: []` and `totalEntries: 0` is the same as what the
     * real service shows when the file does not exist — existing
     * tests do not check history, so the double should not paint
     * anything.
     */
    history: async () => ({
      ok: true as const,
      entries: [],
      rejected: [],
      totalEntries: 0,
    }),
    formats: () => ["postman", "openapi", "insomnia", "bruno", "har", "curl"],
    frameworks: () => ["express", "laravel", "graphql"],
    exists: async () => true,
    ...overrides,
  };
}

const cuerpo = (r: { body: unknown }): Record<string, unknown> =>
  r.body as Record<string, unknown>;

/**
 * Languages go through their own route, not through
 * `/api/capabilities`, because they change for a different reason:
 * formats and frameworks are of the product; languages are of whoever
 * uses it —you can add one by dropping a file, and then this
 * response changes without the product having changed.
 */
describe("/api/locales", () => {
  test("returns the languages with their native name and their texts", async () => {
    const r = await handleUiRequest("/api/locales", {}, deps());
    expect(r.status).toBe(200);
    const locales = cuerpo(r)["locales"] as Array<{ code: string; nativeName: string }>;
    expect(locales[0]?.code).toBe("en");
    expect(locales[0]?.nativeName).toBe("English");
  });

  /**
   * Files someone dropped that could not be read travel in the
   * response, not to a server log: whoever wrote them is looking
   * at the interface, not at the terminal.
   */
  test("rejected languages reach the interface, not a log", async () => {
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
 * Settings that survive close.
 *
 * There is no save button: the interface calls save as soon as a
 * control is touched. A button gets forgotten, and then the
 * setting someone changed is not there next time — which is
 * exactly what persistent settings come to avoid.
 */
describe("/api/settings", () => {
  test("returns what was saved", async () => {
    const d = deps();
    await handleUiRequest("/api/settings/save", { locale: "es" }, d);
    const r = await handleUiRequest("/api/settings", {}, d);

    expect(r.status).toBe(200);
    expect((cuerpo(r)["settings"] as { locale: string }).locale).toBe("es");
  });

  test("saving one preserves the rest", async () => {
    const d = deps();
    await handleUiRequest("/api/settings/save", { locale: "es", theme: "dark" }, d);
    await handleUiRequest("/api/settings/save", { theme: "light" }, d);
    const r = await handleUiRequest("/api/settings", {}, d);

    const s = cuerpo(r)["settings"] as { locale: string; theme: string };
    expect(s.theme).toBe("light");
    expect(s.locale).toBe("es");
  });

  /**
   * A body without anything recognisable is an error and not an
   * empty save: returning `ok` without having saved anything leaves
   * the caller believing their setting is set.
   */
  test("a save with nothing recognisable is rejected", async () => {
    const r = await handleUiRequest("/api/settings/save", { inventado: "x" }, deps());
    expect(r.status).toBe(400);
    const error = cuerpo(r)["error"] as { nextAction: string };
    expect(error.nextAction).toContain("locale");
  });

  /**
   * The reason why saved settings could not be read travels to the
   * interface, not to a server log: settings that disappear without
   * explanation look like a program failure.
   */
  test("a problem reading them reaches the interface", async () => {
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
 * Picking a folder by browsing, not by typing it: that is where
 * mistakes happen most, because a typo returns "does not exist"
 * and there is no hint of where you were.
 */
describe("/api/browse", () => {
  test("lists the folders of a path", async () => {
    const r = await handleUiRequest("/api/browse", { path: "/casa" }, deps());
    expect(r.status).toBe(200);
    const entries = cuerpo(r)["entries"] as Array<{ name: string }>;
    expect(entries[0]?.name).toBe("api");
  });

  /**
   * A folder without permission is a legitimate response from the
   * browser, not a failure of the route: it is returned as-is, with
   * its `ok: false`, so the interface can show it instead of
   * treating it as a crash.
   */
  test("an unreadable folder is returned as-is, not as an HTTP error", async () => {
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
 * The dry run: shows what would come out **without writing anything**.
 */
describe("/api/dry-run", () => {
  test("returns the plan with the files and the requests", async () => {
    const r = await handleUiRequest("/api/dry-run", { projectRoot: "/x" }, deps());
    expect(r.status).toBe(200);
    const plan = cuerpo(r)["plan"] as { requests: number; files: unknown[] };
    expect(plan.requests).toBe(9);
    expect(plan.files).toHaveLength(1);
  });

  /** And it does not generate: it is a dry run. */
  test("dry-running does not write anything", async () => {
    const d = deps();
    await handleUiRequest("/api/dry-run", { projectRoot: "/x" }, d);
    expect(d.generado).toEqual([]);
  });

  test("without a folder it says so and explains what to pick", async () => {
    const r = await handleUiRequest("/api/dry-run", {}, deps());
    expect(r.status).toBe(400);
    const error = cuerpo(r)["error"] as { nextAction: string };
    expect(error.nextAction).toContain("project root");
  });

  test("a folder that does not exist returns 404", async () => {
    const r = await handleUiRequest(
      "/api/dry-run",
      { projectRoot: "/no/existe" },
      deps({ exists: async () => false }),
    );
    expect(r.status).toBe(404);
  });

  /**
   * An invalid plan is a 400: something impossible has been asked,
   * the dry run has not failed.
   */
  test("a made-up format invalidates the plan with output", async () => {
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
  test("says which formats and frameworks are available, so the interface draws itself", async () => {
    const r = await handleUiRequest("/api/capabilities", {}, deps());
    expect(r.status).toBe(200);
    expect(cuerpo(r)["formats"]).toContain("openapi");
    expect(cuerpo(r)["frameworks"]).toContain("express");
  });
});

describe("/api/inspect — shows before writing", () => {
  test("returns the project summary", async () => {
    const r = await handleUiRequest("/api/inspect", { projectRoot: "/x" }, deps());
    expect(r.status).toBe(200);
    expect((cuerpo(r)["summary"] as IProjectSummary).routesInCode).toBe(9);
  });

  test("without a folder, it says so and explains what to pick", async () => {
    const r = await handleUiRequest("/api/inspect", {}, deps());
    expect(r.status).toBe(400);
    const error = cuerpo(r)["error"] as { nextAction: string };
    expect(error.nextAction).toContain("raíz");
  });

  test("a folder that does not exist returns 404, not a server failure", async () => {
    const r = await handleUiRequest(
      "/api/inspect",
      { projectRoot: "/no/existe" },
      deps({ exists: async () => false }),
    );
    expect(r.status).toBe(404);
  });

  /**
   * Zero routes is not an error: a project that does not have
   * endpoints yet is legitimate. But saying so here avoids
   * generating an empty collection and making it look like the
   * tool failed.
   */
  test("zero routes is not an error, it is a notice", async () => {
    const r = await handleUiRequest(
      "/api/inspect",
      { projectRoot: "/x" },
      deps({ summarize: async () => ({ ...RESUMEN, routesInCode: 0 }) }),
    );
    expect(r.status).toBe(200);
    expect(cuerpo(r)["notice"]).toBeDefined();
  });

  test("inspecting does not generate anything", async () => {
    const d = deps();
    await handleUiRequest("/api/inspect", { projectRoot: "/x" }, d);
    expect(d.generado).toEqual([]);
  });
});

describe("/api/generate", () => {
  test("passes the folder and the formats to the pipeline, without reinterpreting them", async () => {
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
   * The format is validated **before** calling the pipeline:
   * failing after having started to write is how folders end up
   * half-done.
   */
  test("a made-up format is rejected before reaching generation", async () => {
    const d = deps();
    const r = await handleUiRequest(
      "/api/generate",
      { projectRoot: "/x", formats: ["inventado"] },
      d,
    );
    expect(r.status).toBe(400);
    expect(d.generado).toEqual([]);
    const error = cuerpo(r)["error"] as { nextAction: string };
    // And it says which ones are valid, which is the actionable part.
    expect(error.nextAction).toContain("postman");
  });

  test("without formats, the pipeline decides its default", async () => {
    const d = deps();
    await handleUiRequest("/api/generate", { projectRoot: "/x" }, d);
    expect(d.generado[0]).not.toHaveProperty("formats");
  });

  /**
   * Auto-detection cannot always be right —monorepos, aliased
   * dependencies—. Forcing the framework in the interface supports
   * whoever the detection leaves out, and the list comes from the
   * catalog, not a second source.
   */
  test("a framework from the catalog is passed to the pipeline as-is", async () => {
    const d = deps();
    const r = await handleUiRequest(
      "/api/generate",
      { projectRoot: "/x", framework: "laravel" },
      d,
    );
    expect(r.status).toBe(200);
    expect(d.generado[0]).toMatchObject({ projectRoot: "/x", framework: "laravel" });
  });

  test("a made-up framework is rejected with the catalog list", async () => {
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
   * Writing outside the project is a legitimate use —gathering
   * several collections in one place—. What cannot go unnoticed:
   * the response says where the collection ended up when the
   * destination is not inside the project.
   */
  test("a destination outside the project is accepted and announced", async () => {
    const r = await handleUiRequest(
      "/api/generate",
      { projectRoot: "/x", outputDir: "/otro/sitio" },
      deps(),
    );
    expect(r.status).toBe(200);
    const aviso = cuerpo(r)["notice"] as string;
    // The notice points to the real collection, which is what the
    // person comes looking for.
    expect(aviso).toContain("outside the project");
    expect(aviso).toContain(".postman_collection.json");
  });

  test("the default destination, inside the project, does not generate a notice", async () => {
    const r = await handleUiRequest(
      "/api/generate",
      // The conventional folder is the project constant
      // (`OUTPUT_DIR_NAME`); hardcoding the name here is what broke
      // this test on the b00001 rebrand.
      { projectRoot: "/x", outputDir: `/x/${OUTPUT_DIR_NAME}` },
      deps(),
    );
    expect(r.status).toBe(200);
    expect(cuerpo(r)["notice"]).toBeUndefined();
  });

  /**
   * `bruno` is the native format of another product. Postman does
   * not import it; offering it as an equivalent would deceive
   * whoever picks it expecting to reimport there.
   */
  test("capabilities distinguishes what Postman imports from what it does not", async () => {
    const r = await handleUiRequest("/api/capabilities", {}, deps());
    expect(r.status).toBe(200);
    expect(cuerpo(r)["formats"]).toContain("bruno");
    const importables = cuerpo(r)["postmanImportable"] as string[];
    expect(importables).not.toContain("bruno");
    expect(importables).toContain("postman");
  });
});

describe("a route that does not exist", () => {
  test("returns 404 and says which ones exist", async () => {
    const r = await handleUiRequest("/api/inventada", {}, deps());
    expect(r.status).toBe(404);
    const error = cuerpo(r)["error"] as { nextAction: string };
    expect(error.nextAction).toContain("/api/generate");
  });
});

describe("all errors are actionable", () => {
  /**
   * In a graphical interface there is no `--help` at hand: a
   * message that says what happened but not what to do leaves the
   * person stuck in front of a screen.
   */
  test.for([
    ["/api/inspect", {}],
    ["/api/generate", {}],
    ["/api/inventada", {}],
  ] as const)("%s carries `nextAction`", async ([ruta, body]) => {
    const r = await handleUiRequest(ruta, body, deps());
    expect(r.status).toBeGreaterThanOrEqual(400);
    const error = cuerpo(r)["error"] as { reason: string; nextAction: string };
    expect(error.reason.length).toBeGreaterThan(0);
    expect(error.nextAction.length).toBeGreaterThan(0);
  });
});
