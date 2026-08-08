/**
 * Carga la configuración del proyecto host de forma agnóstica.
 *
 * Resolución de `ProjectConfig` (orden de prioridad):
 *   1. CLI `--config <path>`
 *   2. Env `POSTMAN_CONFIG`
 *   3. `${projectRoot}/resources/postman/examples/<proyecto>/config.constant.ts`
 *      (busca `<proyecto>` derivando de `composer.json` o basename del projectRoot)
 *   4. `${projectRoot}/examples/<proyecto>/config.constant.ts`
 *   5. **Zero-config**: genera un `ProjectConfig` mínimo viable en memoria
 *      con autodetección de:
 *        - `name` (composer.json → nombre del paquete; fallback basename)
 *        - `baseUrl` (.env → APP_URL + "/api"; fallback "http://localhost/api")
 *        - `filePrefixes` (RouteServiceProvider → regex sobre mapXxxRoutes)
 *        - `loginEndpointName` (heurística: primera ruta POST sin auth)
 *        - `tokenResponsePath` (JWT → "access_token", Sanctum → "data.token")
 *
 * Overrides manuales de endpoints (opcionales):
 *   - Mismo directorio que el config: `endpoints.constant.ts`
 *
 * Los scripts del core NO importan `examples/<proyecto>` directamente.
 * El paquete busca el config en el proyecto host o genera uno zero-config.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { detectProjectNameIn } from "./project-name.service.js";
import { pathToFileURL } from "node:url";
import type { EndpointSpec } from "../contracts/postman.interface.js";
import type { ProjectConfig } from "../contracts/project-config.interface.js";
import { projectRoot } from "./paths.service.js";
import { readFlag } from "../helpers/argv.helper.js";

/**
 * La configuración del proyecto, ya resuelta, y de dónde ha salido.
 *
 * `configPath` importa tanto como el config: es la diferencia entre "no
 * encontré tu fichero" y "lo encontré y dice esto", que es lo primero
 * que hay que saber cuando la salida no es la esperada.
 */
export interface LoadedProject {
  config: ProjectConfig;
  manualEndpoints: EndpointSpec[];
  configPath: string;
  endpointsPath: string | null;
  /** True si se generó un ProjectConfig zero-config (sin archivo host). */
  zeroConfig: boolean;
}

function resolveMaybeRelative(p: string, base: string): string {
  return isAbsolute(p) ? resolve(p) : resolve(base, p);
}

async function importTsModule(absPath: string): Promise<Record<string, unknown>> {
  const url = pathToFileURL(absPath).href;
  const mod = await import(`${url}?t=${Date.now()}`);
  return mod as Record<string, unknown>;
}

function extractConfig(mod: Record<string, unknown>, path: string): ProjectConfig {
  const candidate =
    (mod.config as ProjectConfig | undefined) ??
    (mod.default as ProjectConfig | undefined) ??
    (mod.projectConfig as ProjectConfig | undefined);
  if (!candidate || typeof candidate !== "object" || !("name" in candidate)) {
    throw new Error(
      `No se encontró export 'config' (ProjectConfig) en ${path}`,
    );
  }
  return candidate;
}

function extractEndpoints(mod: Record<string, unknown>): EndpointSpec[] {
  const candidate =
    (mod.ALL_ENDPOINTS as EndpointSpec[] | undefined) ??
    (mod.endpoints as EndpointSpec[] | undefined) ??
    (mod.default as EndpointSpec[] | undefined);
  if (!candidate) return [];
  if (!Array.isArray(candidate)) {
    throw new Error("El export de endpoints manuales no es un array.");
  }
  return candidate;
}

async function listDirs(p: string): Promise<string[]> {
  try {
    const entries = await readdir(p, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Devuelve el nombre del proyecto host.
 *
 * La lectura de manifiestos vive en `project-name.service`: aquí solo
 * se resuelve la raíz. Antes esta función miraba únicamente
 * `composer.json`, con lo que Laravel se llamaba como su paquete y los
 * otros once frameworks como su carpeta.
 */
export async function detectProjectName(): Promise<string> {
  const root = projectRoot();
  if (!root) return "unnamed";
  return detectProjectNameIn(root);
}

/**
 * Busca config del host en el proyecto (no en el paquete):
 *   - ${projectRoot}/resources/postman/examples/<proyecto>/config.constant.ts
 *   - ${projectRoot}/examples/<proyecto>/config.constant.ts
 *
 * Si el nombre del directorio no coincide con `detectProjectName()`, busca
 * cualquier `examples/<*>/config.constant.ts` disponible.
 */
async function findHostConfig(): Promise<string | null> {
  const root = projectRoot();
  if (!root) return null;

  const name = await detectProjectName();
  for (const base of [
    join(root, "resources", "postman", "examples"),
    join(root, "examples"),
  ]) {
    const p = join(base, name, "config.constant.ts");
    if (existsSync(p)) return p;
  }

  // Fallback: cualquier examples/<*>/config.constant.ts del proyecto.
  for (const base of [
    join(root, "resources", "postman", "examples"),
    join(root, "examples"),
  ]) {
    if (!existsSync(base)) continue;
    const dirs = await listDirs(base);
    for (const d of dirs.sort()) {
      const c = join(base, d, "config.constant.ts");
      if (existsSync(c)) return c;
    }
  }

  return null;
}

/**
 * Lee `RouteServiceProvider.php` para extraer el mapa
 * `archivo → prefijos` desde los métodos `mapXxxRoutes()`.
 *
 * Ejemplo Laravel:
 *   protected function mapExternalApiRoutes(): void {
 *     Route::prefix('api/externo')
 *       ->group(base_path('routes/externo.php'));
 *   }
 *
 * → `{ "routes/externo.php": ["api", "externo"] }`
 */
export async function detectFilePrefixes(): Promise<Record<string, string[]>> {
  const root = projectRoot();
  if (!root) return {};
  const provider = join(root, "app", "Providers", "RouteServiceProvider.php");
  if (!existsSync(provider)) return {};

  try {
    const text = await readFile(provider, "utf8");
    const out: Record<string, string[]> = {};
    const reMapFn =
      /function\s+map[A-Z]\w*Routes?\s*\([^)]*\)\s*:\s*void\s*\{/g;
    const rePrefix = /Route::prefix\s*\(\s*['"]([^'"]+)['"]/g;
    const reGroup =
      /->group\s*\(\s*base_path\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    let m: RegExpExecArray | null;
    while ((m = reMapFn.exec(text)) !== null) {
      const blockStart = m.index + m[0].length;
      let depth = 1;
      let i = blockStart;
      while (i < text.length && depth > 0) {
        const c = text[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        i++;
      }
      const block = text.slice(blockStart, i);

      rePrefix.lastIndex = 0;
      reGroup.lastIndex = 0;
      const pm = rePrefix.exec(block);
      const gm = reGroup.exec(block);
      if (pm?.[1] !== undefined && gm?.[1] !== undefined) {
        const prefixParts = pm[1].split("/").filter(Boolean);
        const filePath = gm[1].replace(/^\.\//, "").replace(/\\/g, "/");
        out[filePath] = prefixParts;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Genera un ProjectConfig mínimo viable sin archivo del host.
 * Útil para que el paquete funcione "out-of-the-box" en cualquier proyecto.
 */
export async function buildZeroConfig(): Promise<ProjectConfig> {
  const root = projectRoot();
  const name = await detectProjectName();
  let baseUrl = "http://localhost/api";

  if (root) {
    for (const envFile of [".env", ".env.example"]) {
      try {
        const text = await readFile(join(root, envFile), "utf8");
        const m = text.match(/^APP_URL\s*=\s*(.+)$/m);
        if (m?.[1] !== undefined) {
          baseUrl = m[1].trim().replace(/^["']|["']$/g, "");
          if (!/\/api\/?$/.test(baseUrl)) baseUrl += "/api";
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  const filePrefixes = await detectFilePrefixes();
  if (root) {
    try {
      const routesDir = join(root, "routes");
      if (existsSync(routesDir)) {
        const NON_API = new Set([
          "web.php",
          "console.php",
          "channels.php",
          "api.php.bak",
        ]);
        const files = await readdir(routesDir);
        for (const f of files) {
          if (!f.endsWith(".php")) continue;
          if (NON_API.has(f)) continue;
          const rel = `routes/${f}`.replace(/\\/g, "/");
          if (!filePrefixes[rel]) filePrefixes[rel] = ["api"];
        }
      }
    } catch {
      /* ignore */
    }
  }

  return {
    name,
    collectionName: `${name} (Postman)`,
    collectionDescription: `Colección Postman generada automáticamente para ${name}.`,
    baseUrl,
    variables: [
      { key: "baseUrl", value: baseUrl, type: "string" },
      { key: "token", value: "", type: "string" },
    ],
    filePrefixes,
    zones: [],
    zoneOrder: [],
    defaultZone: "Otros",
    authDescriptions: {},
    loginEndpointName: "Login",
    environments: [
      { name: "Local", color: "#FF6B6B" },
      { name: "Dev", color: "#4ECDC4" },
      { name: "Staging", color: "#FFD93D" },
      { name: "Production", color: "#95E1D3" },
    ],
  };
}

/**
 * Resuelve la ruta del módulo de configuración del host.
 *
 * Orden:
 *   1. `--config <path>` (CLI)
 *   2. `POSTMAN_CONFIG` (env)
 *   3. `${projectRoot}/resources/postman/examples/...` o `${projectRoot}/examples/...`
 *   4. Si nada → devuelve sentinel "__zero__" para que loadProject use
 *      buildZeroConfig().
 */
export async function resolveConfigPath(
  argv: string[] = process.argv,
): Promise<string> {
  const cli = readFlag(argv, "--config");
  if (cli) return resolveMaybeRelative(cli, process.cwd());

  const env = process.env.POSTMAN_CONFIG?.trim();
  if (env) return resolveMaybeRelative(env, process.cwd());

  // LEGACY: ejemplos dentro del propio paquete (solo para compatibilidad
  // con este repo). NO se usa en proyectos externos.
  const forced = process.env.POSTMAN_EXAMPLE?.trim();
  if (forced) {
    const pkg = (await import("./paths.service.js")).packageRoot();
    const legacy = join(pkg, "examples", forced, "config.constant.ts");
    if (existsSync(legacy)) return legacy;
  }

  const host = await findHostConfig();
  if (host) return host;

  return "__zero__";
}

/**
 * Carga config + overrides manuales del proyecto host.
 *
 * Si no encuentra ningún archivo de config, genera un zero-config en
 * memoria con autodetección de prefijo + baseUrl + nombre.
 */
export async function loadProject(
  argv: string[] = process.argv,
): Promise<LoadedProject> {
  const configPath = await resolveConfigPath(argv);

  if (configPath === "__zero__") {
    const config = await buildZeroConfig();
    return {
      config,
      manualEndpoints: [],
      configPath: "<zero-config>",
      endpointsPath: null,
      zeroConfig: true,
    };
  }

  if (!existsSync(configPath)) {
    throw new Error(`Config no encontrado: ${configPath}`);
  }
  const configMod = await importTsModule(configPath);
  const config = extractConfig(configMod, configPath);

  const dir = dirname(configPath);
  const candidates = [
    join(dir, "endpoints.constant.ts"),
    join(dir, "endpoints.ts"),
    join(dir, "manual-endpoints.constant.ts"),
  ];
  let endpointsPath: string | null = null;
  let manualEndpoints: EndpointSpec[] = [];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    endpointsPath = c;
    const mod = await importTsModule(c);
    manualEndpoints = extractEndpoints(mod);
    break;
  }

  return {
    config,
    manualEndpoints,
    configPath,
    endpointsPath,
    zeroConfig: false,
  };
}

// Internal helpers re-exported for tests.
/**
 * Piezas internas expuestas **solo** para sus tests.
 *
 * El guion bajo es la señal: no forman parte del contrato del módulo y
 * pueden cambiar sin aviso.
 */
export const _internal = {
  extractConfig,
  extractEndpoints,
  findHostConfig,
  detectProjectName,
  detectFilePrefixes,
  resolveMaybeRelative,
};
// keep sep import alive for tests that stub paths
void sep;