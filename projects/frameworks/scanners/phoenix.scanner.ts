/**
 * `PhoenixScanner` — `IProjectScanner` + `IRouteScanner` para Phoenix
 * (Elixir).
 *
 * Como Rails, Phoenix declara las rutas en un solo fichero
 * (`lib/<app>_web/router.ex`) y tiene un `resources` que expande a
 * varios endpoints. Y como Rails, ese `resources` genera también las
 * acciones `new` y `edit`, que devuelven **formularios HTML** y no
 * existen en una API JSON.
 *
 * Lo propio de Phoenix:
 *   - `scope "/api", MiAppWeb do … end` — el segundo argumento es el
 *     módulo, no parte de la URL.
 *   - `pipe_through :api` — declara el pipeline, no una ruta.
 *   - Los path params se escriben `:id`, igual que en Rails.
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  ParsedRoute,
} from "../../contracts/interfaces/core/scanner.interface.js";

/** Acciones REST de `resources` que tienen sentido en una API JSON. */
const RESOURCE_ACTIONS = [
  { action: "index", method: "GET", suffix: "" },
  { action: "create", method: "POST", suffix: "" },
  { action: "show", method: "GET", suffix: "/{id}" },
  { action: "update", method: "PUT", suffix: "/{id}" },
  { action: "delete", method: "DELETE", suffix: "/{id}" },
] as const;

const SCOPE_RE = /^\s*scope\s+"([^"]+)"/;
const RESOURCES_RE = /^\s*resources\s+"([^"]+)"\s*,\s*\w+(.*)$/;
const ROUTE_RE = /^\s*(get|post|put|patch|delete|head|options)\s+"([^"]+)"/;

/** Encuentra el `router.ex` de la aplicación. */
async function findRouter(projectRoot: string): Promise<string | null> {
  const libDir = join(projectRoot, "lib");
  if (!existsSync(libDir)) return null;

  let entries: string[];
  try {
    entries = await readdir(libDir);
  } catch {
    return null;
  }
  // La convención es `lib/<app>_web/router.ex`.
  for (const entry of entries) {
    const candidate = join(libDir, entry, "router.ex");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export class PhoenixProjectScanner implements IProjectScanner {
  readonly framework = "phoenix" as const;

  async detect(projectRoot: string): Promise<number> {
    if (!existsSync(join(projectRoot, "mix.exs"))) return 0;
    try {
      const mix = await readFile(join(projectRoot, "mix.exs"), "utf8");
      if (!/:phoenix\b/.test(mix)) return 0;
    } catch {
      return 0;
    }
    return (await findRouter(projectRoot)) ? 1 : 0.5;
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    return { framework: "phoenix", projectRoot, artifacts: ["mix.exs"] };
  }
}

export class PhoenixRouteScanner implements IRouteScanner {
  readonly framework = "phoenix" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "phoenix";
  }

  async scan(match: IProjectMatch): Promise<ReadonlyArray<ParsedRoute>> {
    const router = await findRouter(match.projectRoot);
    if (!router) return [];

    let source: string;
    try {
      source = await readFile(router, "utf8");
    } catch {
      return [];
    }
    const sourceFile = router.slice(match.projectRoot.length + 1);
    return parseRouter(source, sourceFile);
  }
}

/** Recorre el `router.ex` llevando la pila de `scope` por indentación. */
export function parseRouter(source: string, sourceFile: string): ParsedRoute[] {
  const routes: ParsedRoute[] = [];
  const lines = source.split("\n");
  const stack: Array<{ prefix: string; indent: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Elixir comenta con `#`.
    if (/^\s*#/.test(line)) continue;

    const indent = line.length - line.trimStart().length;

    if (/^\s*end\s*$/.test(line)) {
      while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? 0) >= indent) {
        stack.pop();
      }
      continue;
    }

    const scope = SCOPE_RE.exec(line);
    if (scope) {
      stack.push({ prefix: scope[1] ?? "", indent });
      continue;
    }

    const prefix = stack.map((entry) => entry.prefix).join("");

    const resources = RESOURCES_RE.exec(line);
    if (resources) {
      routes.push(
        ...expandResources(resources[1] ?? "", resources[2] ?? "", prefix, sourceFile, i + 1),
      );
      continue;
    }

    const route = ROUTE_RE.exec(line);
    if (route) {
      const rawUri = route[2] ?? "";
      routes.push({
        lineNumber: i + 1,
        method: (route[1] ?? "").toUpperCase(),
        uri: joinRoutePath("/", prefix, normalizePhoenixParams(rawUri)),
        rawUri,
        sourceFile,
        prefixChain: stack.map((entry) => entry.prefix),
      });
    }
  }

  return dedupe(routes);
}

function expandResources(
  path: string,
  options: string,
  prefix: string,
  sourceFile: string,
  lineNumber: number,
): ParsedRoute[] {
  const only = listOption(options, "only");
  const except = listOption(options, "except");

  const routes: ParsedRoute[] = [];
  for (const { action, method, suffix } of RESOURCE_ACTIONS) {
    if (only.length > 0 && !only.includes(action)) continue;
    if (except.includes(action)) continue;
    routes.push({
      lineNumber,
      method,
      uri: joinRoutePath("/", prefix, path, suffix),
      rawUri: `${path}${suffix}`,
      sourceFile,
      prefixChain: prefix ? [prefix] : [],
      actionName: action,
    });
  }
  return routes;
}

/** `only: [:index, :show]` → `["index", "show"]`. */
function listOption(options: string, name: string): string[] {
  const match = new RegExp(String.raw`${name}:\s*\[([^\]]*)\]`).exec(options);
  return (match?.[1] ?? "")
    .split(",")
    .map((value) => value.replace(/[:\s]/g, ""))
    .filter(Boolean);
}

/** Phoenix escribe `:id`; el pipeline espera `{id}`. */
export function normalizePhoenixParams(uri: string): string {
  return uri.replace(/:(\w+)/g, "{$1}");
}

function dedupe(routes: ReadonlyArray<ParsedRoute>): ParsedRoute[] {
  const seen = new Set<string>();
  const out: ParsedRoute[] = [];
  for (const route of routes) {
    const key = `${route.method} ${route.uri}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(route);
  }
  return out;
}
