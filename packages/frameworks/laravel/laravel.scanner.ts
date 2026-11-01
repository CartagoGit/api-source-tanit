/**
 * `LaravelRouteScanner` — concrete implementation of the `IRouteScanner`
 * and `IProjectScanner` contracts for Laravel projects.
 *
 * This class is the FIRST implementation; it will coexist with
 * `OpenApiRouteScanner`, `ExpressRouteScanner`, etc. when they are
 * added.
 *
 * It keeps the Laravel logic that used to live in
 * `route-parser.service.ts` and in the now-removed `paths.service.ts`
 * singleton (r00010 S2, 2026-09-03), to avoid regressions: parses
 * `Route::…` with regex, resolves prefixes from
 * `RouteServiceProvider`, returns `ParsedRoute` in its neutral form.
 */
import { existsSync } from "node:fs";
import { ownRegex } from "../../core/helpers/regex.helper.js";
import { readFile, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import { emptyResult, withEvidence } from "../scanners/detect-result.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IProjectScannerResult,
  IRouteScanner,
  IScanResult,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contracts/interfaces/core/scanner.interface.js";
import type { LaravelScannerOptions } from "../../contracts/interfaces/frameworks/scanners.interface.js";

const ROUTE_METHOD_RE = /Route::(get|post|put|delete|patch)\s*\(\s*['"]([^'"]*)['"]/i;
const RESOURCE_RE =
  /Route::(apiResource|resource)\s*\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z0-9_\\]+)::class([^)]*)\)/;
const PREFIX_RE = /Route::prefix\(\s*['"]([^'"]+)['"]/;
const ACTION_RE =
  /\[\s*([A-Za-z0-9_]+)::class\s*,\s*['"]([A-Za-z0-9_]+)['"]\s*\]/;
const USE_RE =
  /use\s+([A-Za-z0-9_\\]+)\s*(?:as\s+([A-Za-z0-9_]+))?\s*;/g;
const PROVIDER_RE =
  /function\s+map[A-Z]\w*Routes?\s*\([^)]*\)\s*:\s*void\s*\{/g;
const PROVIDER_PREFIX_RE = /Route::prefix\s*\(\s*['"]([^'"]+)['"]/g;
const PROVIDER_GROUP_RE =
  /->group\s*\(\s*base_path\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Pattern `->where('foo', '\d+')` in the context of a route call. */
const WHERE_RE = /->where\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;

/** RESTful routes expanded for `Route::resource` (7 verbs). */
const RESOURCE_ROUTES: ReadonlyArray<{ method: string; suffix: string; action: string }> = [
  { method: "GET", suffix: "", action: "index" },
  { method: "GET", suffix: "/create", action: "create" },
  { method: "POST", suffix: "", action: "store" },
  { method: "GET", suffix: "/{id}", action: "show" },
  { method: "GET", suffix: "/{id}/edit", action: "edit" },
  { method: "PUT", suffix: "/{id}", action: "update" },
  { method: "DELETE", suffix: "/{id}", action: "destroy" },
];

/** RESTful routes expanded for `Route::apiResource` (5 verbs, no UI). */
const API_RESOURCE_ROUTES: ReadonlyArray<{ method: string; suffix: string; action: string }> = [
  { method: "GET", suffix: "", action: "index" },
  { method: "POST", suffix: "", action: "store" },
  { method: "GET", suffix: "/{id}", action: "show" },
  { method: "PUT", suffix: "/{id}", action: "update" },
  { method: "DELETE", suffix: "/{id}", action: "destroy" },
];

/**
 * Captures `where('field', 'regex')` constraints in the line range
 * from the route declaration up to its closing (`;`).
 *
 * @param lines Array of file lines.
 * @param startIndex 0-based index of the declaration line.
 * @returns Map name → regex (without JS slashes).
 */
function captureWhereConstraints(
  lines: string[],
  startIndex: number,
): Map<string, string> {
  const out = new Map<string, string>();
  // Searches a 5-line forward window (enough for
  // `Route::get(...)->where('foo', '\d+')->where('bar', '...');`).
  const end = Math.min(startIndex + 5, lines.length);
  for (let i = startIndex; i < end; i++) {
    const line = lines[i] ?? "";
    let m: RegExpExecArray | null;
    const whereRe = ownRegex(WHERE_RE);
    while ((m = whereRe.exec(line)) !== null) {
      const name = m[1];
      const pattern = m[2];
      if (name && pattern) {
        out.set(name, pattern);
      }
    }
  }
  return out;
}

/**
 * Encodes a URI with `where()` constraints into the shape
 * `{name:regex}`. If there are no constraints, returns `{name}`.
 */
function encodeWithConstraints(name: string, constraints: Map<string, string>): string {
  const c = constraints.get(name);
  if (!c) return `{${name}}`;
  // Laravel accepts the regex without delimiters; Postman also
  // accepts it visually (e.g. `{id:\\\\d+}`), but for consistency
  // with other scanners we use `:p` and leave the signature in
  // `displayName` if needed. We return the URI as `{name:regex}`
  // visually.
  return `{${name}:${c}}`;
}

/**
 * Encodes `where()` constraints into an already-built URI. If the
 * `{name}` field is in `constraints`, it is converted to
 * `{name:regex}`.
 */
function encodeWithConstraintsInUri(
  uri: string,
  constraints: Map<string, string>,
): string {
  if (constraints.size === 0) return uri;
  return uri.replace(/\{([^}]+)\}/g, (whole, name) => {
    const c = constraints.get(name);
    return c ? `{${name}:${c}}` : whole;
  });
}

function resolveControllerClass(
  alias: string,
  imports: Map<string, string>,
): string {
  return imports.get(alias) ?? `App\\Http\\Controllers\\${alias}`;
}

/** Route files that are NOT HTTP API. */
const NON_API_ROUTE_FILES = new Set([
  "web.php",
  "console.php",
  "channels.php",
  "api.php.bak",
]);

function singularizeResourceName(resourceUri: string): string {
  const lastSegment = resourceUri.split("/").filter(Boolean).pop() ?? resourceUri;
  const irregular: Record<string, string> = {
    people: "person",
    men: "man",
    women: "woman",
    children: "child",
  };
  const lower = lastSegment.toLowerCase();
  const irregularSingular = irregular[lower];
  if (irregularSingular) {
    return lastSegment === lower
      ? irregularSingular
      : `${lastSegment.slice(0, 1)}${irregularSingular.slice(1)}`;
  }
  if (/ies$/i.test(lastSegment) && lastSegment.length > 3) {
    return `${lastSegment.slice(0, -3)}y`;
  }
  if (/(ches|shes|sses|xes|zes)$/i.test(lastSegment)) {
    return lastSegment.slice(0, -2);
  }
  if (/ses$/i.test(lastSegment)) {
    return lastSegment.slice(0, -2);
  }
  if (/s$/i.test(lastSegment) && !/ss$/i.test(lastSegment)) {
    return lastSegment.slice(0, -1);
  }
  return lastSegment;
}

function resourceParameterName(options: string, resourceUri: string): string {
  const explicit = /parameters\s*\(\s*\[?\s*['"]?[^'"\]]+['"]?\s*=>\s*['"]([^'"]+)['"]/i.exec(options);
  return explicit?.[1] ?? singularizeResourceName(resourceUri);
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export class LaravelProjectScanner implements IProjectScanner {
  readonly framework = "laravel" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const hasArtisan = existsSync(join(projectRoot, "artisan"));
    const hasRoutes = existsSync(join(projectRoot, "routes"));
    const hasApp = existsSync(join(projectRoot, "app"));
    const hasComposer = existsSync(join(projectRoot, "composer.json"));
    if (!hasArtisan) return emptyResult(0);
    const signals: Array<{ signal: string; weight: number; artifact?: string }> = [
      { signal: "artisan presente (CLI canónico de Laravel)", weight: 0.4, artifact: "artisan" },
    ];
    if (hasRoutes) signals.push({ signal: "directorio routes/ presente", weight: 0.2, artifact: "routes/" });
    if (hasApp) signals.push({ signal: "directorio app/ presente", weight: 0.2, artifact: "app/" });
    if (hasComposer) signals.push({ signal: "composer.json presente", weight: 0.2, artifact: "composer.json" });
    const score = signals.reduce((acc, s) => acc + s.weight, 0);
    return withEvidence(Math.min(score, 1), signals);
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const artifacts: string[] = [];
    if (existsSync(join(projectRoot, "composer.json"))) {
      artifacts.push("composer.json");
    }
    if (existsSync(join(projectRoot, "artisan"))) {
      artifacts.push("artisan");
    }
    if (existsSync(join(projectRoot, "app", "Providers", "RouteServiceProvider.php"))) {
      artifacts.push("app/Providers/RouteServiceProvider.php");
    }
    return {
      framework: "laravel",
      projectRoot,
      artifacts,
    };
  }
}

// ---------------------------------------------------------------------------
// file:prefixes auto-detection (from RouteServiceProvider)
// ---------------------------------------------------------------------------

async function detectFilePrefixes(projectRoot: string): Promise<Record<string, string[]>> {
  const provider = join(projectRoot, "app", "Providers", "RouteServiceProvider.php");
  if (!existsSync(provider)) return {};
  try {
    const text = await readFile(provider, "utf8");
    const out: Record<string, string[]> = {};
    let m: RegExpExecArray | null;
    const providerRe = ownRegex(PROVIDER_RE);
    while ((m = providerRe.exec(text)) !== null) {
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
      const pm = ownRegex(PROVIDER_PREFIX_RE).exec(block);
      const gm = ownRegex(PROVIDER_GROUP_RE).exec(block);
      if (pm?.[1] && gm?.[1]) {
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

function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/(^|[^:])\/\/.*$/gm, "$1");
  return out;
}

// ---------------------------------------------------------------------------
// Route scanner
// ---------------------------------------------------------------------------

export class LaravelRouteScanner implements IRouteScanner {
  readonly framework = "laravel" as const;

  constructor(private readonly opts: LaravelScannerOptions = {}) {}

  matches(_match: IProjectMatch): boolean {
    return _match.framework === "laravel";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const projectRoot = match.projectRoot;
    const routesDir = join(projectRoot, "routes");
    if (!existsSync(routesDir)) return { routes: [] };

    let entries: string[];
    try {
      entries = await readdir(routesDir);
    } catch {
      return { routes: [] };
    }

    const filePrefixes =
      this.opts.filePrefixes ?? (await detectFilePrefixes(projectRoot));

    // Fill in default prefixes for files not listed.
    const phpFiles = entries.filter((e) => e.endsWith(".php") && !NON_API_ROUTE_FILES.has(e));
    const out: ParsedRoute[] = [];
    for (const f of phpFiles) {
      const rel = `routes/${f}`;
      const prefixes = filePrefixes[rel] ?? ["api"];
      const parsed = await parseRoutesFile(rel, prefixes, projectRoot);
      out.push(...parsed);
    }
    return { routes: out };
  }
}

export async function parseRoutesFile(
  relPath: string,
  initialPrefix: string[],
  projectRoot: string,
): Promise<ParsedRoute[]> {
  const abs = join(projectRoot, relPath);
  let raw: string;
  try {
    raw = await readFile(abs, "utf8");
  } catch {
    return [];
  }
  const text = stripComments(raw);

  const imports = new Map<string, string>();
  let um: RegExpExecArray | null;
  const useRe = ownRegex(USE_RE);
  while ((um = useRe.exec(text)) !== null) {
    const fqcn = um[1];
    if (!fqcn) continue;
    const short = fqcn.split("\\").pop() ?? fqcn;
    const alias = um[2] ?? short;
    imports.set(alias, fqcn);
    if (!imports.has(short)) imports.set(short, fqcn);
  }

  const prefixStack: string[] = [...initialPrefix];
  const out: ParsedRoute[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const nextLine = lines[i + 1] ?? "";
    const window = `${line} ${nextLine}`;

    const pm = PREFIX_RE.exec(line);
    if (pm?.[1]) {
      prefixStack.push(pm[1]);
    }
    if (/\}\s*\)/.test(line) && prefixStack.length > initialPrefix.length) {
      prefixStack.pop();
    }

    // Route::resource / Route::apiResource → expand to N routes.
    const resourceMatch = RESOURCE_RE.exec(line);
    if (resourceMatch?.[1] && resourceMatch[2] && resourceMatch[3]) {
      const kind = resourceMatch[1];
      const resourceUri = resourceMatch[2];
      const alias = resourceMatch[3];
      const matchEnd = (resourceMatch.index ?? 0) + resourceMatch[0].length;
      const options = `${resourceMatch[4] ?? ""}${line.slice(matchEnd)}`;
      const controllerClass = resolveControllerClass(alias, imports);
      const whereConstraints = captureWhereConstraints(lines, i);
      const expanded =
        kind === "apiResource" ? API_RESOURCE_ROUTES : RESOURCE_ROUTES;
      // Laravel uses the singular name of the resource as the implicit
      // parameter; `->parameters(['users' => 'user_id'])` lets you
      // override it.
      const parameterName = resourceParameterName(options, resourceUri);
      const paramToken = /^[a-z_][\w]*$/i.test(parameterName)
        ? `{${parameterName}}`
        : "{id}";
      for (const r of expanded) {
        const rawForThis = (resourceUri + r.suffix)
          .replace(/^\/+/, "")
          // Substitute the literal `/{id}` of the suffix with the right param.
          .replace(/\{id\}/g, paramToken);
        const segments = rawForThis
          ? [...prefixStack, rawForThis]
          : [...prefixStack];
        const full = joinRoutePath("/", ...segments);
        out.push({
          method: r.method,
          uri: encodeWithConstraintsInUri(full, whereConstraints),
          rawUri: rawForThis,
          sourceFile: relPath,
          lineNumber: i + 1,
          prefixChain: [...prefixStack],
          controllerClass,
          actionName: r.action,
        });
        // a00010 / B-04: `update` also accepts PATCH in Laravel 5+.
        if (r.action === "update") {
          out.push({
            method: "PATCH",
            uri: encodeWithConstraintsInUri(full, whereConstraints),
            rawUri: rawForThis,
            sourceFile: relPath,
            lineNumber: i + 1,
            prefixChain: [...prefixStack],
            controllerClass,
            actionName: r.action,
          });
        }
      }
      continue;
    }

    const rm = ROUTE_METHOD_RE.exec(line);
    if (rm?.[1] !== undefined) {
      const method = rm[1].toUpperCase();
      const rawUri = rm[2] ?? "";
      const segments = rawUri ? [...prefixStack, rawUri] : [...prefixStack];
      const full = joinRoutePath("/", ...segments);

      let controllerClass: string | undefined;
      let actionName: string | undefined;
      const am = ACTION_RE.exec(window);
      if (am?.[1] && am[2]) {
        const alias = am[1];
        actionName = am[2];
        controllerClass = resolveControllerClass(alias, imports);
      }

      const whereConstraints = captureWhereConstraints(lines, i);
      const uriWithConstraints = full.replace(/\{([^}]+)\}/g, (_whole, name) =>
        encodeWithConstraints(name, whereConstraints),
      );

      out.push({
        method,
        uri: uriWithConstraints,
        rawUri,
        sourceFile: relPath,
        lineNumber: i + 1,
        prefixChain: [...prefixStack],
        ...(controllerClass ? { controllerClass } : {}),
        ...(actionName ? { actionName } : {}),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation spec provider (FormRequest)
// ---------------------------------------------------------------------------

/**
 * Validation provider that extracts the rules from Laravel's
 * `FormRequest`. See `form-request-parser.service.ts` for the
 * `class X extends FormRequest { public function rules(): array {...} }`
 * parser.
 *
 * Resolution strategy:
 *   1. `route.controllerClass` + `route.actionName` → `findFormRequestForController`
 *      (respects the naming convention: Index/Store/Update/Destroy + resource).
 *   2. Parse the FormRequest with `parseFormRequest`.
 *   3. Convert each `field → [rules...]` into one or more
 *      `IValidationSpec`s. All rules are `body` by default (Laravel's
 *      FormRequest validates the body of POST/PUT/PATCH; on GET they
 *      are used for query params).
 */
export class LaravelFormRequestValidationProvider
  implements IValidationSpecProvider
{
  readonly framework = "laravel" as const;

  async supports(
    _route: ParsedRoute,
    _match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<boolean> {
    return Boolean(_route.controllerClass && _route.actionName);
  }

  async resolve(
    _route: ParsedRoute,
    _match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<Awaited<ReturnType<IValidationSpecProvider["resolve"]>>> {
    const endpointKey = `${_route.method} ${_route.uri}`.toLowerCase();
    if (!_route.controllerClass || !_route.actionName) {
      return { endpointKey, fields: [] };
    }

    // Late import to avoid cycles and keep startup light.
    const { findFormRequestForController, parseFormRequest } = await import(
      "./form-request-parser.service.js"
    );

    // The projectRoot comes from the match, not from the removed
    // `paths.service` singleton (r00010 S2, 2026-09-03): this lets
    // the provider work over any project without depending on
    // POSTMAN_PROJECT_ROOT, and two scans in the same process don't
    // step on each other.
    const rel = await findFormRequestForController(
      _route.controllerClass,
      _route.actionName,
      resolveProjectContext({ projectRoot: _match.projectRoot }),
    );
    if (!rel) return { endpointKey, fields: [] };

    let rules;
    try {
      rules = await parseFormRequest(
        rel,
        resolveProjectContext({ projectRoot: _match.projectRoot }),
      );
    } catch {
      return { endpointKey, fields: [] };
    }
    if (rules.isEmpty || Object.keys(rules.rules).length === 0) {
      return { endpointKey, fields: [] };
    }

    const isGet = _route.method.toUpperCase() === "GET";
    const fields: IValidationSpec[] = [];
    for (const [fieldName, fieldRules] of Object.entries(rules.rules)) {
      // `foo.*` is ignored for this first version.
      if (fieldName.includes(".*")) continue;
      const required = fieldRules.includes("required");
      const type = mapLaravelType(fieldRules);
      const spec: IValidationSpec = {
        fieldName,
        location: isGet ? "query" : "body",
        type,
        required,
        ...(extractEnum(fieldRules) ? { enumValues: extractEnum(fieldRules) } : {}),
        ...(extractFormat(fieldRules) ? { format: extractFormat(fieldRules) } : {}),
        ...(extractMaxLength(fieldRules) !== undefined
          ? { maxLength: extractMaxLength(fieldRules) }
          : {}),
        ...(extractMinLength(fieldRules) !== undefined
          ? { minLength: extractMinLength(fieldRules) }
          : {}),
        ...(extractPattern(fieldRules) ? { pattern: extractPattern(fieldRules) } : {}),
      };
      fields.push(spec);
    }
    return { endpointKey, fields };
  }
}

// ---------------------------------------------------------------------------
// Helpers: Laravel rules → IValidationSpec
// ---------------------------------------------------------------------------

const STRING_TYPES = new Set([
  "string",
  "email",
  "url",
  "uuid",
  "ip",
  "mac_address",
  "json",
]);
const NUMBER_TYPES = new Set(["integer", "int", "numeric"]);
const DATE_TYPES = new Set(["date", "date_format", "datetime"]);
const FILE_TYPES = new Set(["file", "image", "mimes"]);

function mapLaravelType(
  rules: string[],
): IValidationSpec["type"] {
  if (rules.some((r) => r.startsWith("in:"))) return "enum";
  if (rules.some((r) => NUMBER_TYPES.has(r))) return "number";
  if (rules.some((r) => r === "integer" || r === "int")) return "integer";
  if (rules.some((r) => r === "boolean" || r === "bool")) return "boolean";
  if (rules.some((r) => r === "array")) return "array";
  if (rules.some((r) => FILE_TYPES.has(r))) return "file";
  if (rules.some((r) => DATE_TYPES.has(r))) {
    return rules.includes("datetime") ? "datetime" : "date";
  }
  if (rules.some((r) => STRING_TYPES.has(r))) return "string";
  return "any";
}

function extractEnum(rules: string[]): ReadonlyArray<string> | undefined {
  const inRule = rules.find((r) => r.startsWith("in:"));
  if (!inRule) return undefined;
  const rest = inRule.slice(3);
  const opts = rest
    .split(",")
    .map((o) => o.replace(/['"]/g, "").trim())
    .filter(Boolean);
  return opts.length > 0 ? opts : undefined;
}

function extractFormat(rules: string[]): string | undefined {
  if (rules.includes("email")) return "email";
  if (rules.includes("url")) return "url";
  if (rules.includes("uuid")) return "uuid";
  if (rules.includes("ip")) return "ipv4";
  if (rules.includes("date")) return "date";
  if (rules.includes("datetime")) return "date-time";
  return undefined;
}

function extractMaxLength(rules: string[]): number | undefined {
  const r = rules.find((x) => x.startsWith("max:"));
  if (!r) return undefined;
  const n = Number(r.slice(4));
  return Number.isFinite(n) ? n : undefined;
}

function extractMinLength(rules: string[]): number | undefined {
  const r = rules.find((x) => x.startsWith("min:"));
  if (!r) return undefined;
  const n = Number(r.slice(4));
  return Number.isFinite(n) ? n : undefined;
}

function extractPattern(rules: string[]): string | undefined {
  const r = rules.find((x) => x.startsWith("regex:"));
  if (!r) return undefined;
  return r.slice(6);
}

// Helper export to avoid unused import warning.
export const _internal = { detectFilePrefixes };
void sep;
