/**
 * `RailsScanner` — `IProjectScanner` + `IRouteScanner` for Ruby on
 * Rails.
 *
 * Rails is the most "declarative" of all supported frameworks: the
 * routes are not scattered through the code, they live **entirely**
 * in `config/routes.rb`. This makes it very reliable to read, but with
 * a subtlety to handle well:
 *
 *     resources :users
 *
 * That line is **seven** endpoints (`index`, `create`, `show`,
 * `update`, `destroy` plus the form ones), just like Laravel's
 * `apiResource`. Counting it as one route would leave 14% of the API.
 *
 * Also handled:
 *   - `namespace :api` and `scope "/v1"` — nested prefixes.
 *   - `only:` and `except:` to limit which actions `resources` generates.
 *   - `resource :profile` (singular): no `index` and no `:id`.
 *   - `member do` / `collection do` — extra routes inside a resource.
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import { effectiveProjectRoot } from "../../core/discovery/effective-project-root.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";

/**
 * The seven actions `resources` generates, with their REST shape.
 *
 * `paramName` is the path-param name as Rails declares it by default
 * (a00010 / B-03): the singular of the resource, not `id`. A
 * `resources :users` produces `/users/{user}` and not `/users/{id}`.
 * Rails lets you override it with `param: :other`, but that case is
 * logged for a future parser refactor; the default behaviour is what
 * the collection expects to see.
 *
 * The generic `id` is kept as a fallback only for `resources` without
 * an inferable name (degenerate case: a resource with characters that
 * break the singulariser).
 */
const RESOURCE_ACTIONS = [
  { action: "index", method: "GET", suffix: "", paramName: "{id}" },
  { action: "create", method: "POST", suffix: "", paramName: "{id}" },
  { action: "new", method: "GET", suffix: "/new", paramName: "{id}" },
  { action: "edit", method: "GET", suffix: "/{id}/edit", paramName: "{id}" },
  { action: "show", method: "GET", suffix: "/{id}", paramName: "{id}" },
  { action: "update", method: "PUT", suffix: "/{id}", paramName: "{id}" },
  { action: "destroy", method: "DELETE", suffix: "/{id}", paramName: "{id}" },
] as const;

/**
 * The actions that make sense in a JSON API.
 *
 * `new` and `edit` return **HTML forms**: they don't exist in an API,
 * and adding them would fill the collection with endpoints that 404.
 * Rails generates them anyway because `resources` also serves apps with
 * views.
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
    // `Gemfile` + `config/routes.rb` is Rails beyond doubt.
    const hasGemfile = existsSync(join(projectRoot, "Gemfile"));
    return withEvidence(hasGemfile ? 1 : 0.7, [
      { signal: "config/routes.rb presente (entry-point canónico de Rails)", weight: 0.7, artifact: "config/routes.rb" },
      ...(hasGemfile ? [{ signal: "Gemfile presente (Rails confirmado)", weight: 0.3, artifact: "Gemfile" }] : []),
    ]);
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

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const source = await readRoutesFile(effectiveProjectRoot(match));
    if (!source) return { routes: [] };
    return { routes: parseRoutesFile(source, "config/routes.rb") };
  }
}

/**
 * Walks `routes.rb` keeping the stack of active prefixes.
 *
 * Indentation drives the count: Ruby closes blocks with `end`, and the
 * depth of `end` tells which prefix to pop. It is the same trick the
 * Laravel parser uses with its `Route::prefix()->group()`.
 */
export function parseRoutesFile(source: string, sourceFile: string): ParsedRoute[] {
  const routes: ParsedRoute[] = [];
  const lines = source.split("\n");

  /** Active prefixes, with the indentation where they were opened. */
  const stack: Array<{ prefix: string; indent: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Ruby comments with `#`. A commented-out route is not a route.
    if (/^\s*#/.test(line)) continue;

    const indent = line.length - line.trimStart().length;

    // An `end` closes the block opened at that indentation.
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
      // `scope module: :api` does not change the URL, only the Ruby module.
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
      // `resources :x do … end` opens a block: routes inside hang from the
      // resource.
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

/** Applies a global regex to a single line, without inheriting state. */
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
  // a00011 C-1: `resources :users, param: :other` is honoured. By
  // default Rails uses `:id`, NOT the singular of the resource — the
  // naive singulariser that lived here (`users → user`) misbehaved on
  // `categories → categorie` and similar. The official docs
  // (guides.rubyonrails.org/routing.html#singular-resources) are
  // clear: the default param is `id`, configurable via
  // `param: :other`. We respect that.
  const explicitParam = paramOption(options);
  const paramToken = explicitParam !== null
    ? `{${explicitParam}}`
    : "{id}";

  const routes: ParsedRoute[] = [];
  for (const { action, method, suffix } of RESOURCE_ACTIONS) {
    if (!API_ACTIONS.has(action)) continue;
    if (only.length > 0 && !only.includes(action)) continue;
    if (except.includes(action)) continue;

    // A singular resource (`resource :profile`) has no listing and no
    // `:id`: it always operates on "mine".
    if (singular && action === "index") continue;
    const path = singular
      ? suffix.replace(/^\/\{id\}/, "")
      : suffix.replace(/\{id\}/g, paramToken);

    routes.push({
      lineNumber,
      method,
      uri: joinRoutePath("/", prefix, name, path),
      rawUri: `${name}${path}`,
      sourceFile,
      prefixChain: prefix ? prefix.split("/") : [],
      actionName: action,
    });

    // a00010 / B-04: Rails 5+ accepts PATCH in addition to PUT for the
    // `update` action. Without the second entry the collection lies:
    // the user imports it, tries PUT, fails, and has to remember to try
    // PATCH on their own. We declare both.
    if (action === "update") {
      routes.push({
        lineNumber,
        method: "PATCH",
        uri: joinRoutePath("/", prefix, name, path),
        rawUri: `${name}${path}`,
        sourceFile,
        prefixChain: prefix ? prefix.split("/") : [],
        actionName: action,
      });
    }
  }
  return routes;
}

/**
 * Extracts `param: :name` from the options of `resources` / `resource`.
 * Returns `null` if not declared, which is the the signal to "use `{id}`
 * by default".
 */
function paramOption(options: string): string | null {
  const match = /param\s*:\s*:?(\w+)/.exec(options);
  return match?.[1] ?? null;
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
  // Also accepted without brackets: `only: :show`.
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
