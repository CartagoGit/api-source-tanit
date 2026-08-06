import { afterEach, describe, expect, test } from "bun:test";
import { withProjectRoot } from "../../service/paths.service";
import { buildZeroConfig, detectProjectName, loadProject } from "../../service/project-loader.service";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture";

let project: ITempProject | null = null;

afterEach(async () => {
  await project?.cleanup();
  project = null;
});

/** Monta un proyecto temporal y ejecuta `fn` con la raíz fijada a él. */
async function inProject<T>(
  files: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  project = await createTempProject(files);
  return withProjectRoot(project.root, fn);
}

describe("detectProjectName", () => {
  test("usa APP_NAME del .env cuando está", async () => {
    const name = await inProject(
      { ".env": "APP_NAME=MiTienda\nAPP_URL=http://localhost\n" },
      detectProjectName,
    );
    expect(name).toBe("MiTienda");
  });

  test("cae al nombre de la carpeta si no hay .env", async () => {
    const name = await inProject({ "composer.json": "{}" }, detectProjectName);
    expect(name.length).toBeGreaterThan(0);
  });

  test("quita las comillas del valor", async () => {
    const name = await inProject({ ".env": 'APP_NAME="Mi Tienda"\n' }, detectProjectName);
    expect(name).not.toContain('"');
  });
});

describe("buildZeroConfig", () => {
  test("produce un config utilizable sin fichero de configuración", async () => {
    const config = await inProject({ ".env": "APP_NAME=Demo\n" }, buildZeroConfig);

    expect(config.name.length).toBeGreaterThan(0);
    expect(config.collectionName.length).toBeGreaterThan(0);
    expect(config.baseUrl.length).toBeGreaterThan(0);
    expect(Array.isArray(config.variables)).toBe(true);
  });

  test("toma la baseUrl de APP_URL", async () => {
    const config = await inProject(
      { ".env": "APP_NAME=Demo\nAPP_URL=https://api.midominio.com\n" },
      buildZeroConfig,
    );
    expect(config.baseUrl).toContain("midominio.com");
  });

  test("sin APP_URL usa un localhost por defecto", async () => {
    const config = await inProject({ ".env": "APP_NAME=Demo\n" }, buildZeroConfig);
    expect(config.baseUrl).toContain("localhost");
  });

  test("declara siempre baseUrl y token como variables", async () => {
    const config = await inProject({ ".env": "APP_NAME=Demo\n" }, buildZeroConfig);
    const keys = config.variables.map((v) => v.key);
    expect(keys).toContain("baseUrl");
    expect(keys).toContain("token");
  });
});

describe("loadProject", () => {
  test("devuelve config aunque el proyecto no tenga config.constant.ts", async () => {
    const { config, manualEndpoints } = await inProject(
      { ".env": "APP_NAME=Demo\n", "package.json": '{"dependencies":{"express":"^4"}}' },
      loadProject,
    );
    expect(config.name.length).toBeGreaterThan(0);
    expect(manualEndpoints).toEqual([]);
  });

  test("informa de la ruta de config usada", async () => {
    const { configPath } = await inProject({ ".env": "APP_NAME=Demo\n" }, loadProject);
    expect(typeof configPath).toBe("string");
  });

  test("sin overrides manuales, endpointsPath es null", async () => {
    const { endpointsPath } = await inProject({ ".env": "APP_NAME=Demo\n" }, loadProject);
    expect(endpointsPath).toBeNull();
  });

  // Dos proyectos analizados en el mismo proceso no deben compartir
  // configuración: era el bug de fondo de p00017.
  test("dos proyectos seguidos cargan cada uno su config", async () => {
    const first = await createTempProject({ ".env": "APP_NAME=Primero\n" });
    const second = await createTempProject({ ".env": "APP_NAME=Segundo\n" });
    try {
      const a = await withProjectRoot(first.root, loadProject);
      const b = await withProjectRoot(second.root, loadProject);
      expect(a.config.name).not.toBe(b.config.name);
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });
});
