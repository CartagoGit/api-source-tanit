/**
 * `RailsScanner` — `IProjectScanner` + `IRouteScanner` para Ruby on
 * Rails.
 *
 * Rails es el caso más "declarativo" de todos los soportados: las rutas
 * no están repartidas por el código, viven **enteras** en
 * `config/routes.rb`. Eso lo hace muy fiable de leer, pero con una
 * particularidad que hay que resolver bien:
 *
 *     resources :users
 *
 * Esa línea son **siete** endpoints (`index`, `create`, `show`,
 * `update`, `destroy` más los de formulario), igual que el
 * `apiResource` de Laravel. Contarla como una ruta sería quedarse con
 * el 14% de la API.
 *
 * También se resuelven:
 *   - `namespace :api` y `scope "/v1"` — prefijos anidados.
 *   - `only:` y `except:` para acotar qué acciones genera `resources`.
 *   - `resource :perfil` (singular): sin `index` y sin `:id`.
 *   - `member do` / `collection do` — rutas extra dentro de un recurso.
 */
import { existsSync } from "node:fs";
import { emptyResult } from "./detect-result.helper";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";

/** Las siete acciones que genera `resources`, con su forma REST. */
const RESOURCE_ACTIONS = [
  { action: "index", method: "GET", suffix: "" },
  { action: "create", method: "POST", suffix: "" },
  { action: "new", method: "GET", suffix: "/new" },
  { action: "edit", method: "GET", suffix: "/{id}/edit" },
  { action: "show", method: "GET", suffix: "/{id}" },
  { action: "update", method: "PUT", suffix: "/{id}" },
  { action: "destroy", method: "DELETE", suffix: "/{id}" },
] as const;

/**
 * Las acciones que tienen sentido en una API JSON.
 *
 * `new` y `edit` devuelven **formularios HTML**: en una API no existen,
 * y meterlas llenaría la colección de endpoints que dan 404. Rails las
 * genera igual porque `resources` sirve también para apps con vistas.
 */
const API_ACTIONS = new Set(["index", "create", "show", "update", "destroy"]);

const RESOURCES_RE = /^\s*(resources?)\s+:(\w+)(.*)$/gm;
const SIMPLE_ROUTE_RE = /^\s*(get|post|put|patch|delete)\s+['"]([^'"]+)['"]/gm;
const NAMESPACE_RE = /^\s*(namespace|scope)\s+[:'"]([\w/-]+)['"]?(.*)$/gm;

async function readRoutesFile(projectRoot: string): Promise<string | null> {
  const path = join(projectRoot, "config", "routes.rb");
  if (!existsSync(path)) return null;
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export class RailsProjectScanner implements IProjectScanner {
  readonly framework = "rails" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    if (!existsSync(join(projectRoot, "config", "routes.rb"))) return emptyResult(0);
    // `Gemfile` + `config/routes.rb` es Rails sin lugar a dudas.
    return emptyResult(existsSync(join(projectRoot, "Gemfile")) ? 1 : 0.7);
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    return {
      framework: "rails",
      projectRoot,
      artifacts: ["config/routes.rb"],
    };
  }
}

export class RailsRouteScanner implements IRouteScanner {
  readonly framework = "rails" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "rails";
  }

  async scan(match: IProjectMatch): Promise<ReadonlyArray<ParsedRoute>> {
    const source = await readRoutesFile(match.projectRoot);
    if (!source) return [];
    return parseRoutesFile(source, "config/routes.rb");
  }
}

/**
 * Recorre `routes.rb` manteniendo la pila de prefijos activos.
 *
 * Se lleva la cuenta por indentación: Ruby cierra los bloques con
 * `end`, y la profundidad del `end` dice qué prefijo se desapila. Es lo
 * mismo que hace el parser de Laravel con sus `Route::prefix()->group()`.
 */
export function parseRoutesFile(source: string, sourceFile: string): ParsedRoute[] {
  const routes: ParsedRoute[] = [];
  const lines = source.split("\n");

  /** Prefijos activos, con la indentación en la que se abrieron. */
  const stack: Array<{ prefix: string; indent: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Ruby comenta con `#`. Una ruta comentada no es una ruta.
    if (/^\s*#/.test(line)) continue;

    const indent = line.length - line.trimStart().length;

    // Un `end` cierra el bloque abierto a esa indentación.
    if (/^\s*end\s*$/.test(line)) {
      while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? 0) >= indent) {
        stack.pop();
      }
      continue;
    }

    const prefix = stack.map((entry) => entry.prefix).join("/");

    const namespace = matchOnce(NAMESPACE_RE, line);
    if (namespace) {
      const kind = namespace[1] ?? "";
      const name = namespace[2] ?? "";
      // `scope module: :api` no cambia la URL, solo el módulo Ruby.
      const isPathScope = kind === "namespace" || /^\s*['"]/.test(namespace[0] ?? "");
      if (isPathScope || kind === "namespace") {
        stack.push({ prefix: name, indent });
      }
      continue;
    }

    const resource = matchOnce(RESOURCES_RE, line);
    if (resource) {
      const singular = resource[1] === "resource";
      const name = resource[2] ?? "";
      const options = resource[3] ?? "";
      routes.push(
        ...expandResource(name, singular, options, prefix, sourceFile, i + 1),
      );
      // `resources :x do … end` abre bloque: las rutas de dentro cuelgan
      // del recurso.
      if (/\bdo\b\s*$/.test(line)) stack.push({ prefix: name, indent });
      continue;
    }

    const simple = matchOnce(SIMPLE_ROUTE_RE, line);
    if (simple) {
      const rawUri = simple[2] ?? "";
      routes.push({
        lineNumber: i + 1,
        method: (simple[1] ?? "").toUpperCase(),
        uri: joinRoutePath("/", prefix, normalizeRailsParams(rawUri)),
        rawUri,
        sourceFile,
        prefixChain: stack.map((entry) => entry.prefix),
      });
    }
  }

  return dedupe(routes);
}

/** Aplica un regex global sobre una línea suelta, sin heredar estado. */
function matchOnce(pattern: RegExp, line: string): RegExpExecArray | null {
  const own = new RegExp(pattern.source, pattern.flags.replace("g", "").replace("m", ""));
  return own.exec(line);
}

/** `resources :users` → sus endpoints REST. */
function expandResource(
  name: string,
  singular: boolean,
  options: string,
  prefix: string,
  sourceFile: string,
  lineNumber: number,
): ParsedRoute[] {
  const only = listOption(options, "only");
  const except = listOption(options, "except");

  const routes: ParsedRoute[] = [];
  for (const { action, method, suffix } of RESOURCE_ACTIONS) {
    if (!API_ACTIONS.has(action)) continue;
    if (only.length > 0 && !only.includes(action)) continue;
    if (except.includes(action)) continue;

    // Un recurso singular (`resource :perfil`) no tiene listado ni
    // `:id`: siempre opera sobre "el mío".
    if (singular && action === "index") continue;
    const path = singular ? suffix.replace("/{id}", "") : suffix;

    routes.push({
      lineNumber,
      method,
      uri: joinRoutePath("/", prefix, name, path),
      rawUri: `${name}${path}`,
      sourceFile,
      prefixChain: prefix ? prefix.split("/") : [],
      actionName: action,
    });
  }
  return routes;
}

/** `only: [:index, :show]` → `["index", "show"]`. */
function listOption(options: string, name: string): string[] {
  const match = new RegExp(String.raw`${name}\s*:\s*\[([^\]]*)\]`).exec(options);
  if (match) {
    return (match[1] ?? "")
      .split(",")
      .map((value) => value.replace(/[:\s]/g, ""))
      .filter(Boolean);
  }
  // También se admite sin corchetes: `only: :show`.
  const single = new RegExp(String.raw`${name}\s*:\s*:(\w+)`).exec(options);
  return single?.[1] ? [single[1]] : [];
}

/** Rails escribe `:id`; el resto del pipeline espera `{id}`. */
export function normalizeRailsParams(uri: string): string {
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
