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
 *        - `baseUrl` (`.env` → `APP_URL`; `DEFAULT_BASE_URL` por defecto;
 *          `/api` solo cuando Laravel + RouteServiceProvider lo declara o
 *          `POSTMAN_BASE_PATH` lo aporta — `a00012 S4`)
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
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import type { ProjectConfig } from "../../contracts/interfaces/core/project-config.interface.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import { readFlag } from "../helpers/argv.helper.js";
import type { LoadedProject } from "../../contracts/interfaces/core/discovery.interface.js";
import {
  BASE_PATH_ENV_VAR,
  DEFAULT_BASE_URL,
} from "../../contracts/constants/core/base-url.constant.js";

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
export async function detectProjectName(
  context: IProjectContext,
): Promise<string> {
  return detectProjectNameIn(context.projectRoot);
}

/**
 * Busca config del host en el proyecto (no en el paquete):
 *   - ${projectRoot}/resources/postman/examples/<proyecto>/config.constant.ts
 *   - ${projectRoot}/examples/<proyecto>/config.constant.ts
 *
 * Si el nombre del directorio no coincide con `detectProjectName()`, busca
 * cualquier `examples/<*>/config.constant.ts` disponible.
 */
async function findHostConfig(
  context: IProjectContext,
): Promise<string | null> {
  const root = context.projectRoot;

  const name = await detectProjectName(context);
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
export async function detectFilePrefixes(
  context: IProjectContext,
): Promise<Record<string, string[]>> {
  const root = context.projectRoot;
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
 *
 * `baseUrl` por defecto es el origen (`DEFAULT_BASE_URL`). El sufijo
 * `/api` **no** se añade automáticamente: solo aparece cuando una de
 * las fuentes documentadas en `BASE_PATH_SOURCES` lo aporta. Esto
 * cierra el bug que producía `http://localhost/api/users` en proyectos
 * Express/Flask/Gin/FastAPI sin prefijo global (a00012 H-P2e, S4).
 */
export async function buildZeroConfig(
  context: IProjectContext,
): Promise<ProjectConfig> {
  const root = context.projectRoot;
  const name = await detectProjectName(context);
  let baseUrl: string = DEFAULT_BASE_URL;

  // APP_URL del `.env` se respeta tal cual: quien lo declara sabe lo
  // que hace. Antes se le pegaba `/api` automáticamente, lo que rompía
  // proyectos no-Laravel y proyectos Laravel que ya lo traían.
  if (root) {
    for (const envFile of [".env", ".env.example"]) {
      try {
        const text = await readFile(join(root, envFile), "utf8");
        const m = text.match(/^APP_URL\s*=\s*(.+)$/m);
        if (m?.[1] !== undefined) {
          baseUrl = m[1].trim().replace(/^["']|["']$/g, "");
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  const filePrefixes = await detectFilePrefixes(context);

  // Las rutas de Laravel cuyo RouteServiceProvider **no** mapea
  // reciben `["api"]` como prefijo lógico (la ruta se imprimirá como
  // `/api/<resto>` en la colección). Esto NO toca la `baseUrl`: el
  // sufijo en `baseUrl` solo aparece cuando el RouteServiceProvider
  // declara explícitamente el prefijo o el `POSTMAN_BASE_PATH` lo
  // aporta — ver `applyBasePathSources()`.
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

  baseUrl = applyBasePathSources(baseUrl, filePrefixes);

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
 * Aplica las fuentes de `basePath` que la propuesta `a00012 S4`
 * acepta para añadir un sufijo a la `baseUrl` por defecto.
 *
 * Las cinco fuentes documentadas son:
 *   1. ruta explícita (un `routePrefix` matcheado por un scanner) — se
 *      materializa en `filePrefixes` por el `detectFilePrefixes` y por
 *      los adapters de scanner; este helper recibe el resultado.
 *   2. framework (Laravel/Express/...): `filePrefixes` lo trae.
 *   3. config explícito (`mcp-vertex.config.json#basePath`,
 *      `.expostmanrc.json#basePath`) — futuro; ver S4.
 *   4. OpenAPI `servers[]` — futuro; ver S4.
 *   5. variable de entorno `POSTMAN_BASE_PATH` — implementada aquí.
 *
 * Devuelve la `baseUrl` con el sufijo pegado **una sola vez**: si ya
 * termina en el mismo segmento, no lo duplica.
 */
function applyBasePathSources(
  baseUrl: string,
  filePrefixes: Record<string, ReadonlyArray<string>>,
): string {
  const envPath = process.env[BASE_PATH_ENV_VAR]?.trim();
  if (envPath && envPath.length > 0) {
    return appendBasePath(baseUrl, envPath);
  }
  // Si el primer prefijo de filePrefixes tiene un único segmento (caso
  // típico Laravel: `["api"]`), lo usamos. Esto cubre la fuente (2):
  // el framework ya recogió el prefijo y no hace falta volver a
  // pedirlo al usuario.
  const firstPrefix = firstSingleSegmentPrefix(filePrefixes);
  if (firstPrefix) {
    return appendBasePath(baseUrl, firstPrefix);
  }
  return baseUrl;
}

/**
 * Suma un segmento de path a la `baseUrl`, evitando duplicarlo cuando
 * ya está presente.
 *
 * `appendBasePath("http://localhost", "api")` → `"http://localhost/api"`.
 * `appendBasePath("http://localhost/api", "api")` → `"http://localhost/api"`.
 * `appendBasePath("http://localhost", "/api/v1")` → `"http://localhost/api/v1"`.
 */
function appendBasePath(baseUrl: string, segment: string): string {
  const clean = segment.replace(/^\/+/, "").replace(/\/+$/, "");
  if (clean.length === 0) return baseUrl;
  // Comprobación barata: si la URL ya termina en `/<clean>` (o en su
  // forma con slash final), no se duplica. No es un parseo estricto
  // porque no queremos arrastrar `URL` aquí; basta con el sufijo.
  if (baseUrl === `${baseUrl.replace(/\/$/, "")}/${clean}`) return baseUrl;
  if (new RegExp(`/${escapeRegExp(clean)}/?$`).test(baseUrl)) return baseUrl;
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/${clean}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Devuelve el primer prefijo de `filePrefixes` que tiene un único
 * segmento (caso Laravel `["api"]`). `null` si no hay ninguno.
 *
 * Usado por `applyBasePathSources` para detectar la fuente "framework
 * routePrefix" sin asumir que TODOS los archivos Laravel tienen el
 * mismo prefijo — `detectFilePrefixes` solo llena los que el
 * RouteServiceProvider mapea, así que `null` aquí significa "el
 * usuario no pidió prefijo o el framework no recogió nada".
 */
function firstSingleSegmentPrefix(
  filePrefixes: Record<string, ReadonlyArray<string>>,
): string | null {
  for (const prefixes of Object.values(filePrefixes)) {
    if (prefixes.length === 1) return prefixes[0] ?? null;
  }
  return null;
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
  argv: ReadonlyArray<string> = [],
  context: IProjectContext,
): Promise<string> {
  const root = context.projectRoot;
  const cli = readFlag(argv, "--config");
  if (cli) return resolveMaybeRelative(cli, root);

  const env = process.env.POSTMAN_CONFIG?.trim();
  if (env) return resolveMaybeRelative(env, root);

  // LEGACY: ejemplos dentro del propio paquete (solo para compatibilidad
  // con este repo). NO se usa en proyectos externos.
  const forced = process.env.POSTMAN_EXAMPLE?.trim();
  if (forced) {
    const legacy = join(context.packageRoot, "examples", forced, "config.constant.ts");
    if (existsSync(legacy)) return legacy;
  }

  const host = await findHostConfig(context);
  if (host) return host;

  return "__zero__";
}

/**
 * Carga config + overrides manuales del proyecto host.
 *
 * Si no encuentra ningún archivo de config, genera un zero-config en
 * memoria con autodetección de prefijo + baseUrl + nombre.
 */
/**
 * El contexto es obligatorio para que el loader sea seguro en procesos
 * de vida larga y no vuelva a leer la raíz cacheada del singleton
 * retirado de `paths.service` en r00010 S2 (2026-09-03).
 */
export async function loadProject(
  argv: ReadonlyArray<string> = [],
  context: IProjectContext,
): Promise<LoadedProject> {
  const configPath = await resolveConfigPath(argv, context);

  if (configPath === "__zero__") {
    const config = await buildZeroConfig(context);
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