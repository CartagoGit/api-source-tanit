import { afterEach, describe, expect, test } from "vitest";
import { buildZeroConfig, detectProjectName, loadProject } from "../../packages/core/discovery/project-loader.service";
import { resolveProjectContext } from "../../packages/core/discovery/project-context.service";
import type { IProjectContext } from "../../packages/contracts/interfaces/core/project-context.interface";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture";

let project: ITempProject | null = null;

afterEach(async () => {
  await project?.cleanup();
  project = null;
});

/** Monta un proyecto temporal y ejecuta `fn` con la raíz fijada a él. */
async function inProject<T>(
  files: Record<string, string>,
  fn: (context: IProjectContext) => Promise<T>,
): Promise<T> {
  project = await createTempProject(files);
  return fn(resolveProjectContext({ projectRoot: project.root }));
}

describe("detectProjectName", () => {
  test("usa el name de composer.json", async () => {
    const name = await inProject(
      { "composer.json": '{"name": "acme/mi-tienda"}' },
      (context) => detectProjectName(context),
    );
    expect(name).toBe("mi-tienda");
  });

  test("se queda con el último segmento de vendor/paquete", async () => {
    const name = await inProject(
      { "composer.json": '{"name": "vendor/sub/api"}' },
      (context) => detectProjectName(context),
    );
    expect(name).toBe("api");
  });

  test("sin composer.json cae al nombre de la carpeta", async () => {
    const name = await inProject({ ".env": "APP_NAME=Demo\n" }, (context) => detectProjectName(context));
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toBe("unnamed");
  });

  test("un composer.json sin name cae al nombre de la carpeta", async () => {
    const name = await inProject({ "composer.json": "{}" }, (context) => detectProjectName(context));
    expect(name.length).toBeGreaterThan(0);
  });
});

describe("buildZeroConfig", () => {
  test("produce un config utilizable sin fichero de configuración", async () => {
    const config = await inProject({ ".env": "APP_NAME=Demo\n" }, (context) => buildZeroConfig(context));

    expect(config.name.length).toBeGreaterThan(0);
    expect(config.collectionName.length).toBeGreaterThan(0);
    expect(config.baseUrl.length).toBeGreaterThan(0);
    expect(Array.isArray(config.variables)).toBe(true);
  });

  test("toma la baseUrl de APP_URL", async () => {
    const config = await inProject(
      { ".env": "APP_NAME=Demo\nAPP_URL=https://api.midominio.com\n" },
      (context) => buildZeroConfig(context),
    );
    expect(config.baseUrl).toContain("midominio.com");
  });

  test("sin APP_URL usa un localhost por defecto", async () => {
    const config = await inProject({ ".env": "APP_NAME=Demo\n" }, (context) => buildZeroConfig(context));
    expect(config.baseUrl).toContain("localhost");
  });

  test("declara siempre baseUrl y token como variables", async () => {
    const config = await inProject({ ".env": "APP_NAME=Demo\n" }, (context) => buildZeroConfig(context));
    const keys = config.variables.map((v) => v.key);
    expect(keys).toContain("baseUrl");
    expect(keys).toContain("token");
  });
});

describe("loadProject", () => {
  test("devuelve config aunque el proyecto no tenga config.constant.ts", async () => {
    const { config, manualEndpoints } = await inProject(
      { ".env": "APP_NAME=Demo\n", "package.json": '{"dependencies":{"express":"^4"}}' },
      (context) => loadProject([], context),
    );
    expect(config.name.length).toBeGreaterThan(0);
    expect(manualEndpoints).toEqual([]);
  });

  test("informa de la ruta de config usada", async () => {
    const { configPath } = await inProject(
      { ".env": "APP_NAME=Demo\n" },
      (context) => loadProject([], context),
    );
    expect(typeof configPath).toBe("string");
  });

  test("sin overrides manuales, endpointsPath es null", async () => {
    const { endpointsPath } = await inProject(
      { ".env": "APP_NAME=Demo\n" },
      (context) => loadProject([], context),
    );
    expect(endpointsPath).toBeNull();
  });

  // Dos proyectos analizados en el mismo proceso no deben compartir
  // configuración: era el bug de fondo de p00017.
  test("dos proyectos seguidos cargan cada uno su config", async () => {
    const first = await createTempProject({ ".env": "APP_NAME=Primero\n" });
    const second = await createTempProject({ ".env": "APP_NAME=Segundo\n" });
    try {
      const a = await loadProject(
        [],
        resolveProjectContext({ projectRoot: first.root }),
      );
      const b = await loadProject(
        [],
        resolveProjectContext({ projectRoot: second.root }),
      );
      expect(a.config.name).not.toBe(b.config.name);
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });
});
