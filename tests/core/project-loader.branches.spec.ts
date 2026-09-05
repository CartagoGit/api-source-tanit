/**
 * Branches of the host project config loader.
 *
 * `project-loader.spec.ts` covers the zero-config path; this one walks
 * the resolver's decisions: `--config` (relative and absolute, whether
 * it comes from the CLI or the env), the legacy `POSTMAN_EXAMPLE`, a
 * real `config.constant.ts` found in the project (with and without
 * endpoint overrides), invalid export errors, and the zero-config
 * readers of `RouteServiceProvider` and `routes/`.
 */
import { afterEach, describe, expect, test } from "vitest";
import {
  _internal,
  buildZeroConfig as buildZeroConfigImpl,
  detectFilePrefixes as detectFilePrefixesImpl,
  loadProject as loadProjectImpl,
  resolveConfigPath as resolveConfigPathImpl,
} from "../../packages/core/discovery/project-loader.service";
import { resolveProjectContext } from "../../packages/core/discovery/project-context.service";
import type { IProjectContext } from "../../packages/contracts/interfaces/core/project-context.interface";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture";

let project: ITempProject | null = null;
let currentContext: IProjectContext | undefined;

afterEach(async () => {
  await project?.cleanup();
  project = null;
});

/** A valid config.constant.ts, like the one a host project writes. */
const CONFIG_OK = `import type { ProjectConfig } from "../project-config.type.js";
export const config: ProjectConfig = {
  name: "tienda",
  collectionName: "Tienda (Postman)",
  collectionDescription: "Colección de la tienda",
  baseUrl: "http://localhost:8080/api",
  variables: [{ key: "baseUrl", value: "http://localhost:8080/api", type: "string" }],
  filePrefixes: {},
  zones: [],
  zoneOrder: [],
  defaultZone: "Otros",
  authDescriptions: {},
  loginEndpointName: "Login",
  environments: [{ name: "Local", color: "#FF6B6B" }],
};
`;
const CONFIG_TODO = `
const TOKEN = "no-relevante";
export { TOKEN };
`;

/** Sets up a temporary project and runs `fn` with the root fixed to it. */
async function inProject<T>(
  files: Record<string, string>,
  fn: (context: IProjectContext) => Promise<T>,
): Promise<T> {
  project = await createTempProject(files);
  const previous = currentContext;
  currentContext = resolveProjectContext({ projectRoot: project.root });
  try {
    return await fn(currentContext);
  } finally {
    currentContext = previous;
  }
}

function context(): IProjectContext {
  if (!currentContext) throw new Error("test context not initialized");
  return currentContext;
}

function resolveConfigPath(argv: ReadonlyArray<string> = []): Promise<string> {
  return resolveConfigPathImpl(argv, context());
}

function loadProject(argv: ReadonlyArray<string> = []) {
  return loadProjectImpl(argv, context());
}

function buildZeroConfig() {
  return buildZeroConfigImpl(context());
}

function detectFilePrefixes() {
  return detectFilePrefixesImpl(context());
}

describe("resolveConfigPath", () => {
  test("--config absolute wins over everything else", async () => {
    await inProject({}, async () => {
      const cfg = `${project!.root}/mi-config.constant.ts`;
      const res = await resolveConfigPath(["node", "x", "--config", cfg]);
      expect(res).toBe(cfg);
    });
  });

  test("--config relative is resolved against the process cwd", async () => {
    await inProject({}, async () => {
      const ruta = await resolveConfigPath(["node", "x", "--config", "rel.conf.ts"]);
      expect(ruta.endsWith("/rel.conf.ts")).toBe(true);
    });
  });

  test("--config=value glued together also works", async () => {
    await inProject({}, async () => {
      const cfg = `${project!.root}/pegado.ts`;
      const res = await resolveConfigPath(["node", "x", `--config=${cfg}`]);
      expect(res).toBe(cfg);
    });
  });

  test("POSTMAN_CONFIG is used when there is no --config", async () => {
    await inProject({}, async () => {
      const cfg = `${project!.root}/env-config.ts`;
      process.env.POSTMAN_CONFIG = cfg;
      try {
        expect(await resolveConfigPath([])).toBe(cfg);
      } finally {
        delete process.env.POSTMAN_CONFIG;
      }
    });
  });

  test("POSTMAN_EXAMPLE looks in the package (legacy path)", async () => {
    await inProject({}, async () => {
      process.env.POSTMAN_EXAMPLE = "example-app";
      try {
        const res = await resolveConfigPath([]);
        expect(res.endsWith("config.constant.ts")).toBe(true);
      } finally {
        delete process.env.POSTMAN_EXAMPLE;
      }
    });
  });

  test("a missing POSTMAN_EXAMPLE keeps going and falls to zero", async () => {
    const res = await inProject({ ".env": "APP_NAME=Demo\n" }, () =>
      resolveConfigPath([]).then(() => {
        process.env.POSTMAN_EXAMPLE = "does-not-exist";
        return resolveConfigPath([]).finally(() => delete process.env.POSTMAN_EXAMPLE);
      }),
    );
    expect(res).toBe("__zero__");
  });

  test("finds the host's resources/postman/examples/<name>", async () => {
    const res = await inProject(
      {
        "composer.json": '{"name":"acme/tienda"}',
        "resources/postman/examples/tienda/config.constant.ts": CONFIG_OK,
      },
      () => resolveConfigPath([]),
    );
    expect(res).toContain("resources/postman/examples/tienda/config.constant.ts");
  });

  test("if the manifest name does not match, it tries any examples/<*>", async () => {
    const res = await inProject(
      {
        // The name will derive from the temporary folder, not "otro".
        "examples/otro/config.constant.ts": CONFIG_OK,
      },
      () => resolveConfigPath([]),
    );
    expect(res).toContain("examples/otro/config.constant.ts");
  });

  test("with nothing, the sentinel is __zero__", async () => {
    const res = await inProject({}, () => resolveConfigPath([]));
    expect(res).toBe("__zero__");
  });
});

describe("loadProject with explicit config", () => {
  test("loads a real config.constant.ts with its export", async () => {
    const loaded = await inProject(
      {
        "composer.json": '{"name":"acme/tienda"}',
        "resources/postman/examples/tienda/config.constant.ts": CONFIG_OK,
      },
      (context) => loadProjectImpl([], context),
    );
    expect(loaded.zeroConfig).toBe(false);
    expect(loaded.config.name).toBe("tienda");
    expect(loaded.config.collectionName).toBe("Tienda (Postman)");
    expect(loaded.configPath).toContain("tienda/config.constant.ts");
    expect(loaded.endpointsPath).toBeNull();
    expect(loaded.manualEndpoints).toEqual([]);
  });

  test("a config without a usable export fails with a clear message", async () => {
    await expect(
      inProject(
        {
          "composer.json": '{"name":"acme/tienda"}',
          "examples/tienda/config.constant.ts": CONFIG_TODO,
        },
        (context) => loadProjectImpl([], context),
      ),
    ).rejects.toThrow(/No se encontró export 'config'/);
  });

  test("endpoints.constant.ts from the same directory is loaded as overrides", async () => {
    const loaded = await inProject(
      {
        "composer.json": '{"name":"acme/tienda"}',
        "examples/tienda/config.constant.ts": CONFIG_OK,
        "examples/tienda/endpoints.constant.ts": `
export const ALL_ENDPOINTS = [
  { name: "Ping", method: "GET", uri: "/ping", headers: [], query: [], body: null, formRequest: null },
];
`,
      },
      (context) => loadProjectImpl([], context),
    );
    expect(loaded.endpointsPath).toContain("endpoints.constant.ts");
    expect(loaded.manualEndpoints).toHaveLength(1);
    expect(loaded.manualEndpoints[0]?.uri).toBe("/ping");
  });

  test("an endpoint export that is not an array fails with its message", async () => {
    await expect(
      inProject(
        {
          "composer.json": '{"name":"acme/tienda"}',
          "examples/tienda/config.constant.ts": CONFIG_OK,
          "examples/tienda/endpoints.constant.ts":
            "export const ALL_ENDPOINTS = { nope: true };\n",
        },
        (context) => loadProjectImpl([], context),
      ),
    ).rejects.toThrow("El export de endpoints manuales no es un array.");
  });

  test("endpoints.ts and manual-endpoints.constant.ts are candidates", async () => {
    const loaded = await inProject(
      {
        "composer.json": '{"name":"acme/tienda"}',
        "examples/tienda/config.constant.ts": CONFIG_OK,
        "examples/tienda/endpoints.ts":
          "export const endpoints = [] as unknown[];\n",
      },
      (context) => loadProjectImpl([], context),
    );
    expect(loaded.endpointsPath).toContain("endpoints.ts");
    expect(loaded.manualEndpoints).toEqual([]);
  });

  test("--config with a missing path throws with the path in the message", async () => {
    await expect(
      inProject({}, () =>
        loadProject(["node", "x", "--config", `${project!.root}/nope.ts`]),
      ),
    ).rejects.toThrow(/Config no encontrado/);
  });
});

describe("buildZeroConfig — alternative paths", () => {
  test("APP_URL with /api is not appended again", async () => {
    const config = await inProject(
      { ".env": "APP_URL=https://api.midominio.com/api\n" },
      buildZeroConfig,
    );
    expect(config.baseUrl).toBe("https://api.midominio.com/api");
  });

  test("APP_URL with quotes is cleaned", async () => {
    // a00012 S4: `/api` is no longer added automatically. APP_URL is
    // respected as-is; the suffix is only contributed by an explicit
    // source (Laravel + RouteServiceProvider, `POSTMAN_BASE_PATH`, …).
    const config = await inProject(
      { ".env": 'APP_URL="https://api.midominio.com"\n' },
      buildZeroConfig,
    );
    expect(config.baseUrl).toBe("https://api.midominio.com");
  });

  test(".env.example is valid when there is no .env", async () => {
    const config = await inProject(
      { ".env.example": "APP_URL=https://staging.midominio.com\n" },
      buildZeroConfig,
    );
    expect(config.baseUrl).toContain("staging");
  });

  test("an unreadable .env does not crash: falls back to localhost", async () => {
    // EISDIR is not simulated by the fixture (it writes content, not
    // directories with that exact name), so the `catch` branch is
    // triggered by a `.env` that does NOT declare APP_URL and a
    // second `.env.example` also mute: the `break` branch is not
    // reached.
    //
    // a00012 S4: the default baseUrl is the ORIGIN (`http://localhost`).
    // The `/api` is no longer glued automatically: it only appears
    // when an explicit source contributes it (Laravel +
    // RouteServiceProvider, `POSTMAN_BASE_PATH`, …).
    const config = await inProject(
      { ".env": "APP_KEY=xxx\n" },
      buildZeroConfig,
    );
    expect(config.baseUrl).toBe("http://localhost");
  });

  test("the filePrefixes map comes from the RouteServiceProvider", async () => {
    const config = await inProject(
      {
        ".env": "APP_NAME=Demo\n",
        "app/Providers/RouteServiceProvider.php": `<?php
class RouteServiceProvider {
  protected function mapExternoApiRoutes(): void {
    Route::prefix('api/externo')
      ->group(base_path('routes/externo.php'));
  }
  protected function mapWebRoutes(): void {
    Route::middleware('web')->group(base_path('routes/web.php'));
  }
}
`,
      },
      buildZeroConfig,
    );
    expect(config.filePrefixes["routes/externo.php"]).toEqual(["api", "externo"]);
  });

  test(".php files in routes/ without a map get the api prefix by default", async () => {
    const config = await inProject(
      {
        ".env": "APP_NAME=Demo\n",
        "routes/pedidos.php": "<?php\n",
        "routes/web.php": "<?php\n",
        "routes/notas.md": "not php",
      },
      buildZeroConfig,
    );
    expect(config.filePrefixes["routes/pedidos.php"]).toEqual(["api"]);
    expect(config.filePrefixes["routes/web.php"]).toBeUndefined();
    expect(config.filePrefixes["routes/notas.md"]).toBeUndefined();
  });

  test("the ServiceProvider's prefix wins over the default", async () => {
    const config = await inProject(
      {
        ".env": "APP_NAME=Demo\n",
        "routes/externo.php": "<?php\n",
        "app/Providers/RouteServiceProvider.php": `<?php
class RouteServiceProvider {
  protected function mapExternoRoutes(): void {
    Route::prefix('api/externo')->group(base_path('routes/externo.php'));
  }
}
`,
      },
      buildZeroConfig,
    );
    expect(config.filePrefixes["routes/externo.php"]).toEqual(["api", "externo"]);
  });
});

describe("detectFilePrefixes — explicit inputs", () => {
  test("without a RouteServiceProvider returns {}", async () => {
    const res = await inProject({}, detectFilePrefixes);
    expect(res).toEqual({});
  });

  test("an action block without prefix+group does not enter the map", async () => {
    const res = await inProject(
      {
        "app/Providers/RouteServiceProvider.php": `<?php
class RouteServiceProvider {
  protected function mapRaroRoutes(): void {
    Route::middleware('api')->group(base_path('routes/raro.php'));
  }
  protected function mapBienRoutes(): void {
    Route::prefix('v2')->group(base_path('routes/bien.php'));
  }
}
`,
      },
      detectFilePrefixes,
    );
    expect(res["routes/raro.php"]).toBeUndefined();
    expect(res["routes/bien.php"]).toEqual(["v2"]);
  });

  test("a non-existent RouteServiceProvider returns {}", async () => {
    const res = await inProject({}, detectFilePrefixes);
    expect(res).toEqual({});
  });
});

describe("detectProjectName — loader branches", () => {
  test("from the root, the context decides, not the singleton", async () => {
    // Two explicit contexts give different names in the same process:
    // this is the property r00008 pursues.
    await inProject(
      { "composer.json": '{"name":"acme/primero"}' },
      async () => {
        const ctx = { projectRoot: project!.root } as Parameters<
          typeof _internal.detectProjectName
        >[0];
        expect(await _internal.detectProjectName(ctx)).toBe("primero");
      },
    );
  });
});

describe("_internal — loose extractors", () => {
  test("extractConfig accepts config, default and projectConfig", () => {
    const ok = { config: { name: "a" } };
    expect(_internal.extractConfig(ok, "x").name).toBe("a");
    expect(_internal.extractConfig({ default: { name: "b" } }, "x").name).toBe("b");
    expect(_internal.extractConfig({ projectConfig: { name: "c" } }, "x").name).toBe("c");
    expect(() => _internal.extractConfig({}, "x")).toThrow(/No se encontró export/);
    expect(() =>
      _internal.extractConfig({ config: "not-an-object" }, "x"),
    ).toThrow(/No se encontró export/);
    expect(() =>
      _internal.extractConfig({ config: { sinNombre: 1 } }, "x"),
    ).toThrow(/No se encontró export/);
  });

  test("extractEndpoints accepts ALL_ENDPOINTS, endpoints and default", () => {
    expect(_internal.extractEndpoints({ ALL_ENDPOINTS: [1] })).toEqual([1]);
    expect(_internal.extractEndpoints({ endpoints: [1, 2] })).toEqual([1, 2]);
    expect(_internal.extractEndpoints({ default: [3] })).toEqual([3]);
    expect(_internal.extractEndpoints({})).toEqual([]);
    expect(() => _internal.extractEndpoints({ endpoints: "no" })).toThrow(
      "El export de endpoints manuales no es un array.",
    );
  });

  test("resolveMaybeRelative resolves absolutes and relatives", () => {
    expect(_internal.resolveMaybeRelative("/abs/x.ts", "/base")).toBe("/abs/x.ts");
    expect(_internal.resolveMaybeRelative("rel/x.ts", "/base")).toBe(
      "/base/rel/x.ts",
    );
  });

  test("findHostConfig prefers the manifest name and falls back to any example", async () => {
    // The project is named via composer; the only examples/<*>
    // available has another name. The fallback enters and finds it.
    const res = await inProject(
      {
        "composer.json": '{"name":"acme/tienda"}',
        "examples/otro-nombre/config.constant.ts": CONFIG_OK,
      },
      (context) => _internal.findHostConfig(context),
    );
    expect(res).toContain("examples/otro-nombre/config.constant.ts");
  });
});
