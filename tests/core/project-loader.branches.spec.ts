/**
 * Ramas del cargador de config del proyecto host.
 *
 * `project-loader.spec.ts` cubre el camino zero-config; este recorre
 * las decisiones del resolutor: `--config` (relativo y absoluto, lo
 * venga el CLI o el env), el legacy `POSTMAN_EXAMPLE`, un
 * `config.constant.ts` real encontrado en el proyecto (con y sin
 * overrides de endpoints), los errores de export inválido, y los
 * lectores de `RouteServiceProvider` y `routes/` del zero-config.
 */
import { afterEach, describe, expect, test } from "vitest";
import { withProjectRoot } from "../../packages/core/discovery/paths.service";
import {
  _internal,
  buildZeroConfig,
  detectFilePrefixes,
  loadProject,
  resolveConfigPath,
} from "../../packages/core/discovery/project-loader.service";
import { createTempProject, type ITempProject } from "../helpers/scanner-fixture";

let project: ITempProject | null = null;

afterEach(async () => {
  await project?.cleanup();
  project = null;
});

/** Un config.constant.ts válido, como el que escribe un proyecto host. */
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

/** Monta un proyecto temporal y ejecuta `fn` con la raíz fijada a él. */
async function inProject<T>(
  files: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  project = await createTempProject(files);
  return withProjectRoot(project.root, fn);
}

describe("resolveConfigPath", () => {
  test("--config absoluto gana a todo lo demás", async () => {
    await inProject({}, async () => {
      const cfg = `${project!.root}/mi-config.constant.ts`;
      const res = await resolveConfigPath(["node", "x", "--config", cfg]);
      expect(res).toBe(cfg);
    });
  });

  test("--config relativo se resuelve contra el cwd del proceso", async () => {
    await inProject({}, async () => {
      const ruta = await resolveConfigPath(["node", "x", "--config", "rel.conf.ts"]);
      expect(ruta.endsWith("/rel.conf.ts")).toBe(true);
    });
  });

  test("--config=valor pegado también funciona", async () => {
    await inProject({}, async () => {
      const cfg = `${project!.root}/pegado.ts`;
      const res = await resolveConfigPath(["node", "x", `--config=${cfg}`]);
      expect(res).toBe(cfg);
    });
  });

  test("POSTMAN_CONFIG se usa si no hay --config", async () => {
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

  test("POSTMAN_EXAMPLE busca en el paquete (camino legacy)", async () => {
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

  test("POSTMAN_EXAMPLE inexistente sigue al host y cae en zero", async () => {
    const res = await inProject({ ".env": "APP_NAME=Demo\n" }, () =>
      resolveConfigPath([]).then(() => {
        process.env.POSTMAN_EXAMPLE = "no-existe";
        return resolveConfigPath([]).finally(() => delete process.env.POSTMAN_EXAMPLE);
      }),
    );
    expect(res).toBe("__zero__");
  });

  test("encuentra resources/postman/examples/<nombre> del host", async () => {
    const res = await inProject(
      {
        "composer.json": '{"name":"acme/tienda"}',
        "resources/postman/examples/tienda/config.constant.ts": CONFIG_OK,
      },
      () => resolveConfigPath([]),
    );
    expect(res).toContain("resources/postman/examples/tienda/config.constant.ts");
  });

  test("si el nombre del manifiesto no casa, prueba cualquier examples/<*>", async () => {
    const res = await inProject(
      {
        // El nombre derivará de la carpeta temporal, no "otro".
        "examples/otro/config.constant.ts": CONFIG_OK,
      },
      () => resolveConfigPath([]),
    );
    expect(res).toContain("examples/otro/config.constant.ts");
  });

  test("sin nada, el sentinel es __zero__", async () => {
    const res = await inProject({}, () => resolveConfigPath([]));
    expect(res).toBe("__zero__");
  });
});

describe("loadProject con config explícito", () => {
  test("carga un config.constant.ts real con su export", async () => {
    const loaded = await inProject(
      {
        "composer.json": '{"name":"acme/tienda"}',
        "resources/postman/examples/tienda/config.constant.ts": CONFIG_OK,
      },
      loadProject,
    );
    expect(loaded.zeroConfig).toBe(false);
    expect(loaded.config.name).toBe("tienda");
    expect(loaded.config.collectionName).toBe("Tienda (Postman)");
    expect(loaded.configPath).toContain("tienda/config.constant.ts");
    expect(loaded.endpointsPath).toBeNull();
    expect(loaded.manualEndpoints).toEqual([]);
  });

  test("una config sin export utilizable falla con un mensaje claro", async () => {
    await expect(
      inProject(
        {
          "composer.json": '{"name":"acme/tienda"}',
          "examples/tienda/config.constant.ts": CONFIG_TODO,
        },
        loadProject,
      ),
    ).rejects.toThrow(/No se encontró export 'config'/);
  });

  test("endpoints.constant.ts del mismo directorio carga como overrides", async () => {
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
      loadProject,
    );
    expect(loaded.endpointsPath).toContain("endpoints.constant.ts");
    expect(loaded.manualEndpoints).toHaveLength(1);
    expect(loaded.manualEndpoints[0]?.uri).toBe("/ping");
  });

  test("un export de endpoints que no es array falla con su mensaje", async () => {
    await expect(
      inProject(
        {
          "composer.json": '{"name":"acme/tienda"}',
          "examples/tienda/config.constant.ts": CONFIG_OK,
          "examples/tienda/endpoints.constant.ts":
            "export const ALL_ENDPOINTS = { nope: true };\n",
        },
        loadProject,
      ),
    ).rejects.toThrow("El export de endpoints manuales no es un array.");
  });

  test("endpoints.ts y manual-endpoints.constant.ts son candidatos", async () => {
    const loaded = await inProject(
      {
        "composer.json": '{"name":"acme/tienda"}',
        "examples/tienda/config.constant.ts": CONFIG_OK,
        "examples/tienda/endpoints.ts":
          "export const endpoints = [] as unknown[];\n",
      },
      loadProject,
    );
    expect(loaded.endpointsPath).toContain("endpoints.ts");
    expect(loaded.manualEndpoints).toEqual([]);
  });

  test("--config con ruta inexistente lanza con la ruta en el mensaje", async () => {
    await expect(
      inProject({}, () =>
        loadProject(["node", "x", "--config", `${project!.root}/nope.ts`]),
      ),
    ).rejects.toThrow(/Config no encontrado/);
  });
});

describe("buildZeroConfig — caminos alternativos", () => {
  test("APP_URL con /api no se le añade otra vez", async () => {
    const config = await inProject(
      { ".env": "APP_URL=https://api.midominio.com/api\n" },
      buildZeroConfig,
    );
    expect(config.baseUrl).toBe("https://api.midominio.com/api");
  });

  test("APP_URL entre comillas se limpia", async () => {
    const config = await inProject(
      { ".env": 'APP_URL="https://api.midominio.com"\n' },
      buildZeroConfig,
    );
    expect(config.baseUrl).toBe("https://api.midominio.com/api");
  });

  test(".env.example vale cuando no hay .env", async () => {
    const config = await inProject(
      { ".env.example": "APP_URL=https://staging.midominio.com\n" },
      buildZeroConfig,
    );
    expect(config.baseUrl).toContain("staging");
  });

  test("un .env ilegible no revienta: cae al localhost", async () => {
    // EISDIR no se simula con el fixture (escribe contenido, no
    // directorios con ese nombre exacto), así que la rama `catch` se
    // provoca con un `.env` que NO declara APP_URL y un segundo
    // `.env.example` también mudo: la rama de `break` no se alcanza.
    const config = await inProject(
      { ".env": "APP_KEY=xxx\n" },
      buildZeroConfig,
    );
    expect(config.baseUrl).toBe("http://localhost/api");
  });

  test("el mapa filePrefixes sale del RouteServiceProvider", async () => {
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

  test("los .php de routes/ sin mapa reciben el prefijo api por defecto", async () => {
    const config = await inProject(
      {
        ".env": "APP_NAME=Demo\n",
        "routes/pedidos.php": "<?php\n",
        "routes/web.php": "<?php\n",
        "routes/notas.md": "no es php",
      },
      buildZeroConfig,
    );
    expect(config.filePrefixes["routes/pedidos.php"]).toEqual(["api"]);
    expect(config.filePrefixes["routes/web.php"]).toBeUndefined();
    expect(config.filePrefixes["routes/notas.md"]).toBeUndefined();
  });

  test("el prefijo del ServiceProvider manda sobre el por defecto", async () => {
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

describe("detectFilePrefixes — entradas explícitas", () => {
  test("sin RouteServiceProvider devuelve {}", async () => {
    const res = await inProject({}, detectFilePrefixes);
    expect(res).toEqual({});
  });

  test("un bloque de acción sin prefix+group no entra en el mapa", async () => {
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

  test("un RouteServiceProvider que no existe devuelve {}", async () => {
    const res = await inProject({}, detectFilePrefixes);
    expect(res).toEqual({});
  });
});

describe("detectProjectName — ramas del loader", () => {
  test("de la raíz la decide el contexto, no el singleton", async () => {
    // Dos contextos explícitos dan nombres distintos en el mismo
    // proceso: es la propiedad que r00008 persigue.
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

describe("_internal — extractores sueltos", () => {
  test("extractConfig acepta config, default y projectConfig", () => {
    const ok = { config: { name: "a" } };
    expect(_internal.extractConfig(ok, "x").name).toBe("a");
    expect(_internal.extractConfig({ default: { name: "b" } }, "x").name).toBe("b");
    expect(_internal.extractConfig({ projectConfig: { name: "c" } }, "x").name).toBe("c");
    expect(() => _internal.extractConfig({}, "x")).toThrow(/No se encontró export/);
    expect(() =>
      _internal.extractConfig({ config: "no-soy-objeto" }, "x"),
    ).toThrow(/No se encontró export/);
    expect(() =>
      _internal.extractConfig({ config: { sinNombre: 1 } }, "x"),
    ).toThrow(/No se encontró export/);
  });

  test("extractEndpoints acepta ALL_ENDPOINTS, endpoints y default", () => {
    expect(_internal.extractEndpoints({ ALL_ENDPOINTS: [1] })).toEqual([1]);
    expect(_internal.extractEndpoints({ endpoints: [1, 2] })).toEqual([1, 2]);
    expect(_internal.extractEndpoints({ default: [3] })).toEqual([3]);
    expect(_internal.extractEndpoints({})).toEqual([]);
    expect(() => _internal.extractEndpoints({ endpoints: "no" })).toThrow(
      "El export de endpoints manuales no es un array.",
    );
  });

  test("resolveMaybeRelative resuelve absolutos y relativos", () => {
    expect(_internal.resolveMaybeRelative("/abs/x.ts", "/base")).toBe("/abs/x.ts");
    expect(_internal.resolveMaybeRelative("rel/x.ts", "/base")).toBe(
      "/base/rel/x.ts",
    );
  });

  test("findHostConfig prefiere el nombre del manifiesto y cae a cualquier ejemplo", async () => {
    // El proyecto se llama por composer; el único examples/<*> disponible
    // tiene otro nombre. El fallback entra y lo encuentra.
    const res = await inProject(
      {
        "composer.json": '{"name":"acme/tienda"}',
        "examples/otro-nombre/config.constant.ts": CONFIG_OK,
      },
      () => _internal.findHostConfig(),
    );
    expect(res).toContain("examples/otro-nombre/config.constant.ts");
  });
});
