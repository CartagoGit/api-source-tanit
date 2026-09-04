/**
 * Loads the host project's configuration in a framework-agnostic way.
 *
 * `ProjectConfig` resolution (priority order):
 *   1. CLI `--config <path>`
 *   2. Env `POSTMAN_CONFIG`
 *   3. `${projectRoot}/resources/postman/examples/<project>/config.constant.ts`
 *      (searches for `<project>` derived from `composer.json` or the projectRoot
 *      basename)
 *   4. `${projectRoot}/examples/<project>/config.constant.ts`
 *   5. **Zero-config**: generates a minimal viable `ProjectConfig` in memory
 *      with autodetection of:
 *        - `name` (`composer.json` → package name; basename fallback)
 *        - `baseUrl` (`.env` → `APP_URL`; defaults to `DEFAULT_BASE_URL`;
 *          `/api` only when Laravel + RouteServiceProvider declares it or
 *          `POSTMAN_BASE_PATH` supplies it — `a00012 S4`)
 *        - `filePrefixes` (RouteServiceProvider → regex over mapXxxRoutes)
 *        - `loginEndpointName` (heuristic: first POST route without auth)
 *        - `tokenResponsePath` (JWT → "access_token", Sanctum → "data.token")
 *
 * Optional manual endpoint overrides:
 *   - In the same directory as the config: `endpoints.constant.ts`
 *
 * Core scripts do NOT import `examples/<project>` directly. The package
 * searches the host project for the config or generates a zero-config.
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
 * Returns the host project name.
 *
 * Manifest reading lives in `project-name.service`: this function only
 * resolves the root. Previously it looked only at `composer.json`, so Laravel
 * was named after its package while the other eleven frameworks were named
 * after their directories.
 */
export async function detectProjectName(
  context: IProjectContext,
): Promise<string> {
  return detectProjectNameIn(context.projectRoot);
}

/**
 * Searches the project, not the package, for the host config:
 *   - ${projectRoot}/resources/postman/examples/<project>/config.constant.ts
 *   - ${projectRoot}/examples/<project>/config.constant.ts
 *
 * If the directory name does not match `detectProjectName()`, search for any
 * available `examples/<*>/config.constant.ts`.
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

  // Fallback: any examples/<*>/config.constant.ts in the project.
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
 * Reads `RouteServiceProvider.php` to extract the
 * `file → prefixes` map from the `mapXxxRoutes()` methods.
 *
 * Laravel example:
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
 * Generates a minimal viable ProjectConfig without a host file, allowing the
 * package to work out of the box in any project.
 *
 * The default `baseUrl` is the origin (`DEFAULT_BASE_URL`). The `/api` suffix
 * is **not** added automatically; it appears only when one of the sources
 * documented in `BASE_PATH_SOURCES` supplies it. This closes the bug that
 * produced `http://localhost/api/users` in Express, Flask, Gin, and FastAPI
 * projects without a global prefix (a00012 H-P2e, S4).
 */
export async function buildZeroConfig(
  context: IProjectContext,
): Promise<ProjectConfig> {
  const root = context.projectRoot;
  const name = await detectProjectName(context);
  let baseUrl: string = DEFAULT_BASE_URL;

  // Respect `APP_URL` from `.env` exactly as declared: whoever declares it
  // knows what they are doing. Previously `/api` was appended automatically,
  // breaking non-Laravel projects and Laravel projects that already included it.
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

  // Laravel routes that the RouteServiceProvider does **not** map receive
  // `["api"]` as their logical prefix (the route is printed as
  // `/api/<resto>` in the collection). This does NOT change `baseUrl`: the
  // suffix in `baseUrl` appears only when RouteServiceProvider explicitly
  // declares the prefix or `POSTMAN_BASE_PATH` supplies it — see
  // `applyBasePathSources()`.
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
 * Applies the `basePath` sources accepted by proposal `a00012 S4` to append a
 * suffix to the default `baseUrl`.
 *
 * The five documented sources are:
 *   1. An explicit path (a `routePrefix` matched by a scanner), materialized
 *      in `filePrefixes` by `detectFilePrefixes` and the scanner adapters; this
 *      helper receives the result.
 *   2. Framework (Laravel/Express/...): `filePrefixes` provides it.
 *   3. Explicit config (`delendai.config.json#basePath`,
 *      `.tanitrc.json#basePath`) — future; see S4.
 *   4. OpenAPI `servers[]` — future; see S4.
 *   5. The `POSTMAN_BASE_PATH` environment variable — implemented here.
 *
 * Returns the `baseUrl` with the suffix appended **once**: if it already ends
 * with the same segment, do not duplicate it.
 */
function applyBasePathSources(
  baseUrl: string,
  filePrefixes: Record<string, ReadonlyArray<string>>,
): string {
  const envPath = process.env[BASE_PATH_ENV_VAR]?.trim();
  if (envPath && envPath.length > 0) {
    return appendBasePath(baseUrl, envPath);
  }
  // If the first prefix in filePrefixes has one segment (the typical Laravel
  // case: `["api"]`), use it. This covers source (2): the framework has
  // already captured the prefix, so the user should not be asked for it again.
  const firstPrefix = firstSingleSegmentPrefix(filePrefixes);
  if (firstPrefix) {
    return appendBasePath(baseUrl, firstPrefix);
  }
  return baseUrl;
}

/**
 * Appends a path segment to `baseUrl` without duplicating it when already
 * present.
 *
 * `appendBasePath("http://localhost", "api")` → `"http://localhost/api"`.
 * `appendBasePath("http://localhost/api", "api")` → `"http://localhost/api"`.
 * `appendBasePath("http://localhost", "/api/v1")` → `"http://localhost/api/v1"`.
 */
function appendBasePath(baseUrl: string, segment: string): string {
  const clean = segment.replace(/^\/+/, "").replace(/\/+$/, "");
  if (clean.length === 0) return baseUrl;
  // Cheap check: if the URL already ends with `/<clean>` (or with a trailing
  // slash), do not duplicate it. This is not strict parsing because we do not
  // want to pull `URL` in here; the suffix is sufficient.
  if (baseUrl === `${baseUrl.replace(/\/$/, "")}/${clean}`) return baseUrl;
  if (new RegExp(`/${escapeRegExp(clean)}/?$`).test(baseUrl)) return baseUrl;
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/${clean}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns the first single-segment prefix in `filePrefixes` (the Laravel
 * `["api"]` case), or `null` if none exists.
 *
 * Used by `applyBasePathSources` to detect the "framework routePrefix" source
 * without assuming that ALL Laravel files share the same prefix —
 * `detectFilePrefixes` only populates the files mapped by RouteServiceProvider,
 * so `null` here means "the user requested no prefix or the framework found
 * none".
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
 * Resolves the host configuration module path.
 *
 * Order:
 *   1. `--config <path>` (CLI)
 *   2. `POSTMAN_CONFIG` (env)
 *   3. `${projectRoot}/resources/postman/examples/...` or `${projectRoot}/examples/...`
 *   4. If nothing matches, return the "__zero__" sentinel so loadProject uses
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

  // LEGACY: examples inside the package itself (for compatibility with this
  // repository only). It is NOT used in external projects.
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
 * Loads the host config and manual overrides.
 *
 * If no config file is found, generate a zero-config in memory with
 * autodetection of the prefix, baseUrl, and name.
 */
/**
 * The context is mandatory so the loader is safe in long-lived processes and
 * does not reread the cached root from the `paths.service` singleton retired
 * in r00010 S2 (2026-09-03).
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
 * Internal pieces exposed **only** for their tests.
 *
 * The underscore is the signal: they are not part of the module contract and
 * may change without notice.
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