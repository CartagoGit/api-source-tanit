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

/** Mounts a temporary project and runs `fn` with the root pinned to it. */
async function inProject<T>(
  files: Record<string, string>,
  fn: (context: IProjectContext) => Promise<T>,
): Promise<T> {
  project = await createTempProject(files);
  return fn(resolveProjectContext({ projectRoot: project.root }));
}

describe("detectProjectName", () => {
  test("uses the composer.json name", async () => {
    const name = await inProject(
      { "composer.json": '{"name": "acme/mi-tienda"}' },
      (context) => detectProjectName(context),
    );
    expect(name).toBe("mi-tienda");
  });

  test("keeps the last segment of vendor/package", async () => {
    const name = await inProject(
      { "composer.json": '{"name": "vendor/sub/api"}' },
      (context) => detectProjectName(context),
    );
    expect(name).toBe("api");
  });

  test("without composer.json falls back to the folder name", async () => {
    const name = await inProject({ ".env": "APP_NAME=Demo\n" }, (context) => detectProjectName(context));
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toBe("unnamed");
  });

  test("a composer.json without name falls back to the folder name", async () => {
    const name = await inProject({ "composer.json": "{}" }, (context) => detectProjectName(context));
    expect(name.length).toBeGreaterThan(0);
  });
});

describe("buildZeroConfig", () => {
  test("produces a usable config without a configuration file", async () => {
    const config = await inProject({ ".env": "APP_NAME=Demo\n" }, (context) => buildZeroConfig(context));

    expect(config.name.length).toBeGreaterThan(0);
    expect(config.collectionName.length).toBeGreaterThan(0);
    expect(config.baseUrl.length).toBeGreaterThan(0);
    expect(Array.isArray(config.variables)).toBe(true);
  });

  test("takes the baseUrl from APP_URL", async () => {
    const config = await inProject(
      { ".env": "APP_NAME=Demo\nAPP_URL=https://api.midominio.com\n" },
      (context) => buildZeroConfig(context),
    );
    expect(config.baseUrl).toContain("midominio.com");
  });

  test("without APP_URL uses a default localhost", async () => {
    const config = await inProject({ ".env": "APP_NAME=Demo\n" }, (context) => buildZeroConfig(context));
    expect(config.baseUrl).toContain("localhost");
  });

  test("always declares baseUrl and token as variables", async () => {
    const config = await inProject({ ".env": "APP_NAME=Demo\n" }, (context) => buildZeroConfig(context));
    const keys = config.variables.map((v) => v.key);
    expect(keys).toContain("baseUrl");
    expect(keys).toContain("token");
  });

  // a00017/S1: the auto-generated collection description must be in
  // English so that the Postman artifact the user opens does not carry
  // Spanish boilerplate that the project's own i18n layer cannot
  // rewrite.
  test("emits an English collection description (a00017/S1)", async () => {
    const config = await inProject(
      { ".env": "APP_NAME=Demo\n" },
      (context) => buildZeroConfig(context),
    );
    expect(config.collectionDescription).toMatch(/^Postman collection auto-generated for /);
    expect(config.collectionDescription).not.toContain("Colección");
    expect(config.collectionDescription).not.toContain("generada automáticamente");
  });
});

describe("loadProject", () => {
  test("returns a config even when the project has no config.constant.ts", async () => {
    const { config, manualEndpoints } = await inProject(
      { ".env": "APP_NAME=Demo\n", "package.json": '{"dependencies":{"express":"^4"}}' },
      (context) => loadProject([], context),
    );
    expect(config.name.length).toBeGreaterThan(0);
    expect(manualEndpoints).toEqual([]);
  });

  test("reports the config path used", async () => {
    const { configPath } = await inProject(
      { ".env": "APP_NAME=Demo\n" },
      (context) => loadProject([], context),
    );
    expect(typeof configPath).toBe("string");
  });

  test("without manual overrides, endpointsPath is null", async () => {
    const { endpointsPath } = await inProject(
      { ".env": "APP_NAME=Demo\n" },
      (context) => loadProject([], context),
    );
    expect(endpointsPath).toBeNull();
  });

  // Two projects analyzed in the same process must not share
  // configuration: that was the underlying bug of p00017.
  test("two projects in a row load each its own config", async () => {
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
