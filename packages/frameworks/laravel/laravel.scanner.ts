/**
 * `LaravelRouteScanner` — implementación concreta del contrato
 * `IRouteScanner` y `IProjectScanner` para proyectos Laravel.
 *
 * Esta clase es la PRIMERA implementación; convivirá con
 * `OpenApiRouteScanner`, `ExpressRouteScanner`, etc. cuando se añadan.
 *
 * Mantiene la lógica Laravel que vivía en `route-parser.service.ts` y
 * en el singleton ya retirado `paths.service.ts` (r00010 S2,
 * 2026-09-03), para evitar regresiones: parsea `Route::…` con regex,
 * resuelve prefijos de `RouteServiceProvider`, devuelve `ParsedRoute`
 * en su forma neutra.
 */
import { existsSync } from "node:fs";
import { ownRegex } from "../../core/helpers/regex.helper.js";
import { readFile, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import { emptyResult } from "../scanners/detect-result.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IProjectScannerResult,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contracts/interfaces/core/scanner.interface.js";
import type { LaravelScannerOptions } from "../../contracts/interfaces/frameworks/scanners.interface.js";

const ROUTE_METHOD_RE = /Route::(get|post|put|delete|patch)\s*\(\s*['"]([^'"]*)['"]/i;
const RESOURCE_RE =
  /Route::(apiResource|resource)\s*\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z0-9_\\]+)::class/;
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

/** Patrón `->where('foo', '\d+')` en el contexto de un route call. */
const WHERE_RE = /->where\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;

/** Rutas RESTful expandidas para `Route::resource` (7 verbos). */
const RESOURCE_ROUTES: ReadonlyArray<{ method: string; suffix: string; action: string }> = [
  { method: "GET", suffix: "", action: "index" },
  { method: "GET", suffix: "/create", action: "create" },
  { method: "POST", suffix: "", action: "store" },
  { method: "GET", suffix: "/{id}", action: "show" },
  { method: "GET", suffix: "/{id}/edit", action: "edit" },
  { method: "PUT", suffix: "/{id}", action: "update" },
  { method: "DELETE", suffix: "/{id}", action: "destroy" },
];

/** Rutas RESTful expandidas para `Route::apiResource` (5 verbos, sin UI). */
const API_RESOURCE_ROUTES: ReadonlyArray<{ method: string; suffix: string; action: string }> = [
  { method: "GET", suffix: "", action: "index" },
  { method: "POST", suffix: "", action: "store" },
  { method: "GET", suffix: "/{id}", action: "show" },
  { method: "PUT", suffix: "/{id}", action: "update" },
  { method: "DELETE", suffix: "/{id}", action: "destroy" },
];

/**
 * Captura las constraints `where('campo', 'regex')` en el rango de
 * líneas desde la declaración del route hasta su cierre (`;` o `;`).
 *
 * @param lines Array de líneas del archivo.
 * @param startIndex 0-based index de la línea donde está la declaración.
 * @returns Map nombre → regex (sin las barras de JS).
 */
function captureWhereConstraints(
  lines: string[],
  startIndex: number,
): Map<string, string> {
  const out = new Map<string, string>();
  // Busca en una ventana de 5 líneas hacia adelante (suficiente para
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
 * Codifica una URI con constraints where() en la forma
 * `{name:regex}`. Si no hay constraints, devuelve `{name}`.
 */
function encodeWithConstraints(name: string, constraints: Map<string, string>): string {
  const c = constraints.get(name);
  if (!c) return `{${name}}`;
  // Laravel acepta el regex sin delimitadores; Postman también lo acepta
  // visualmente (ej. `{id:\\\\d+}`), pero por consistencia con otros
  // scanners usamos `:p` y dejamos la firma en `displayName` si la
  //我们需要. Devolvemos la URI como `{name:regex}` visualmente.
  return `{${name}:${c}}`;
}

/**
 * Codifica `where()` constraints en una URI ya construida. Si el
 * campo `{name}` está en `constraints`, se convierte a `{name:regex}`.
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

/** Archivos de rutas que NO son HTTP API. */
const NON_API_ROUTE_FILES = new Set([
  "web.php",
  "console.php",
  "channels.php",
  "api.php.bak",
]);

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
    if (!hasRoutes || !hasApp) return emptyResult(0.5);
    if (hasComposer) return emptyResult(1);
    return emptyResult(0.7);
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

  async scan(match: IProjectMatch): Promise<ReadonlyArray<ParsedRoute>> {
    const projectRoot = match.projectRoot;
    const routesDir = join(projectRoot, "routes");
    if (!existsSync(routesDir)) return [];

    let entries: string[];
    try {
      entries = await readdir(routesDir);
    } catch {
      return [];
    }

    const filePrefixes =
      this.opts.filePrefixes ?? (await detectFilePrefixes(projectRoot));

    // Rellena prefijos por defecto para archivos no listados.
    const phpFiles = entries.filter((e) => e.endsWith(".php") && !NON_API_ROUTE_FILES.has(e));
    const out: ParsedRoute[] = [];
    for (const f of phpFiles) {
      const rel = `routes/${f}`;
      const prefixes = filePrefixes[rel] ?? ["api"];
      const parsed = await parseRoutesFile(rel, prefixes, projectRoot);
      out.push(...parsed);
    }
    return out;
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

    // Route::resource / Route::apiResource → expande a N routes.
    const resourceMatch = RESOURCE_RE.exec(line);
    if (resourceMatch?.[1] && resourceMatch[2] && resourceMatch[3]) {
      const kind = resourceMatch[1];
      const resourceUri = resourceMatch[2];
      const alias = resourceMatch[3];
      const controllerClass = resolveControllerClass(alias, imports);
      const whereConstraints = captureWhereConstraints(lines, i);
      const expanded =
        kind === "apiResource" ? API_RESOURCE_ROUTES : RESOURCE_ROUTES;
      for (const r of expanded) {
        const rawForThis = (resourceUri + r.suffix).replace(/^\/+/, "");
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
 * Provider de validación que extrae las reglas de los `FormRequest`
 * de Laravel. Ver `form-request-parser.service.ts` para el parser
 * de `class X extends FormRequest { public function rules(): array {...} }`.
 *
 * Estrategia de resolución:
 *   1. `route.controllerClass` + `route.actionName` → `findFormRequestForController`
 *      (respeta la convención de naming: Index/Store/Update/Destroy + resource).
 *   2. Parsea el FormRequest con `parseFormRequest`.
 *   3. Convierte cada `campo → [reglas...]` en uno o más `IValidationSpec`.
 *      Todas las reglas son `body` por defecto (los FormRequest en Laravel
 *      validan el body de POST/PUT/PATCH; en GET se usan para query params).
 */
export class LaravelFormRequestValidationProvider
  implements IValidationSpecProvider
{
  readonly framework = "laravel" as const;

  async supports(_route: ParsedRoute, _match: IProjectMatch): Promise<boolean> {
    return Boolean(_route.controllerClass && _route.actionName);
  }

  async resolve(
    _route: ParsedRoute,
    _match: IProjectMatch,
  ): Promise<Awaited<ReturnType<IValidationSpecProvider["resolve"]>>> {
    const endpointKey = `${_route.method} ${_route.uri}`.toLowerCase();
    if (!_route.controllerClass || !_route.actionName) {
      return { endpointKey, fields: [] };
    }

    // Importación tardía para evitar ciclos y mantener arranque liviano.
    const { findFormRequestForController, parseFormRequest } = await import(
      "./form-request-parser.service.js"
    );

    // El projectRoot viene del match, no del singleton retirado de
    // `paths.service` (r00010 S2, 2026-09-03): así el provider funciona
    // sobre cualquier proyecto sin depender de POSTMAN_PROJECT_ROOT y dos
    // escaneos en el mismo proceso no se pisan.
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
      // `algo.*` se ignora para esta primera versión.
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

// Helper export para evitar warning de unused en imports.
export const _internal = { detectFilePrefixes };
void sep;
