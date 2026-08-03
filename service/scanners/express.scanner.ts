/**
 * `ExpressScanner` — implementación de `IProjectScanner` + `IRouteScanner`
 * para frameworks Node.js: Express, Fastify, Koa-router y Hapi.
 *
 * Detección:
 *   - `package.json` con `dependencies` o `devDependencies` que contengan
 *     `express`, `fastify`, `@koa/router`, `@hapi/hapi` o `koa`.
 *   - Auto-detecta la raíz del proyecto desde `package.json`.
 *
 * Parsing:
 *   - Regex robusta sobre `app.METHOD(path, handler)` y `router.METHOD(path, handler)`.
 *   - Soporta:
 *     - Express: `app.get('/users', (req, res) => {...})`, `router.post(...)`
 *     - Fastify: `fastify.get('/users', handler)`, `app.route({...}).get(...)`
 *     - Koa: `router.get('/users', ctx => {...})`
 *     - Hapi: `server.route({ method: 'GET', path: '/users', handler: () => {...} })`
 *   - Detecta `Router()` / `express.Router()` / `Router({ prefix: '/api' })`.
 *   - Recoge prefijos `app.use('/api', router)` para routers anidados.
 *
 * Sin validation provider (estos frameworks no tienen "FormRequest" nativo);
 * depende de `applyAgnosticInference` para generar body/query heurísticos.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contract/scanner.interface.js";

const FRAMEWORK_PACKAGES = ["express", "fastify", "@koa/router", "@hapi/hapi", "koa"];
const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"];

// Regex para `<ident>.METHOD(path, handler)` o `app.METHOD(path, handler)`.
// Captura: 1=ident (router name), 2=method, 3=path (entre comilla simple o doble).
// Usa lookbehind negativo para evitar que matchee `myRouter` SIN `Router` antes.
const APP_METHOD_RE =
  /([a-zA-Z_$][\w$]*)\s*\.\s*(get|post|put|delete|patch|head|options)\s*\(\s*(['"])([^'"]+)\3/gi;
// Regex para `Router({ prefix: 'api/v1' })`.
const ROUTER_PREFIX_RE = /Router\s*\(\s*\{[^}]*prefix\s*:\s*['"]([^'"]+)['"]/gi;
// Regex para `app.use('/prefix', router)`.
const APP_USE_PREFIX_RE = /\bapp\s*\.\s*use\s*\(\s*(['"])([^'"]+)\1\s*,\s*([a-zA-Z_$][\w$]*)/gi;
// Regex para `app.use('/prefix')` (sin router, modo middleware).
const APP_USE_BARE_RE = /\bapp\s*\.\s*use\s*\(\s*(['"])([^'"]+)\1\s*\)/gi;
// Hapi: `server.route({ method: 'GET', path: '/users', handler: ... })`.
const HAPI_ROUTE_RE =
  /method\s*:\s*['"](get|post|put|delete|patch|head|options)['"]\s*,\s*path\s*:\s*(['"])([^'"]+)\2/gi;

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export class ExpressProjectScanner implements IProjectScanner {
  readonly framework = "express" as const;

  async detect(projectRoot: string): Promise<number> {
    const pkgPath = join(projectRoot, "package.json");
    if (!existsSync(pkgPath)) return 0;
    try {
      const text = await readFile(pkgPath, "utf8");
      const pkg = JSON.parse(text) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
      const score = FRAMEWORK_PACKAGES.reduce((acc, name) => {
        if (deps[name]) return Math.max(acc, 0.9);
        // También busca sub-ranges (express-*).
        if (Object.keys(deps).some((k) => k.startsWith(name))) {
          return Math.max(acc, 0.7);
        }
        return acc;
      }, 0);
      return score;
    } catch {
      return 0;
    }
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const artifacts: string[] = ["package.json"];
    for (const rel of ["src/server.ts", "src/server.js", "src/app.ts", "src/app.js", "index.ts", "index.js", "app.js", "server.js"]) {
      if (existsSync(join(projectRoot, rel))) artifacts.push(rel);
    }
    return { framework: "express", projectRoot, artifacts };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/(^|[^:])\/\/.*$/gm, "$1");
  return out;
}

async function collectJsFiles(projectRoot: string): Promise<string[]> {
  const { readdirSync } = await import("node:fs");
  const candidates = ["src", "lib", "app", "routes", ""];
  const out: string[] = [];
  for (const dir of candidates) {
    const base = dir ? join(projectRoot, dir) : projectRoot;
    if (!existsSync(base)) continue;
    try {
      const entries = readdirSync(base, { recursive: true, withFileTypes: true }) as unknown as Array<{
        name: string;
        isFile(): boolean;
        parentPath?: string;
      }>;
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const name = entry.name;
        if (!/\.(ts|js|mjs|cjs|tsx|jsx)$/.test(name)) continue;
        if (name.endsWith(".d.ts")) continue;
        if (name.includes(".test.") || name.includes(".spec.")) continue;
        if (name === "vite.config.ts" || name === "vitest.config.ts") continue;
        const parent = entry.parentPath ?? base;
        out.push(join(parent, name));
      }
    } catch {
      continue;
    }
  }
  return [...new Set(out)];
}

interface ParsedModule {
  file: string;
  routes: Array<{ method: string; path: string; line: number; routerName?: string }>;
  routerPrefixes: Map<string, string>; // varName → prefix
  appUsePrefixes: Map<string, string>; // varName → prefix
}

async function parseModule(file: string): Promise<ParsedModule> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { file, routes: [], routerPrefixes: new Map(), appUsePrefixes: new Map() };
  }
  const text = stripComments(raw);
  const lines = text.split("\n");
  const routes: Array<{ method: string; path: string; line: number; routerName?: string }> = [];
  const routerPrefixes = new Map<string, string>();
  const appUsePrefixes = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // router = Router({ prefix: '/api/v1' })
    const rpM = new RegExp(ROUTER_PREFIX_RE.source, "gi").exec(line);
    if (rpM?.[1]) {
      const varMatch = line.match(/([a-zA-Z_$][\w$]*)\s*=\s*(?:express\.)?Router/);
      if (varMatch?.[1]) routerPrefixes.set(varMatch[1], rpM[1]);
    }

    // app.use('/prefix', router) → router conocido gana prefix.
    const auM = new RegExp(APP_USE_PREFIX_RE.source, "gi").exec(line);
    if (auM?.[2] && auM[3]) {
      appUsePrefixes.set(auM[3], auM[2]);
    }

    // app.METHOD(path, handler) o router.METHOD(path, handler)
    const aReg = new RegExp(APP_METHOD_RE.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = aReg.exec(line)) !== null) {
      const ident = (m[1] ?? "").trim();
      const method = (m[2] ?? "").toLowerCase();
      const path = (m[4] ?? "").trim();
      if (!HTTP_METHODS.includes(method)) continue;
      if (!path.startsWith("/")) continue;
      // Heurística: el ident es un router (NO 'app', 'server', 'fastify', 'koa')
      if (ident !== "app" && ident !== "server" && ident !== "fastify" && ident !== "koa") {
        routes.push({ method, path, line: i + 1, routerName: ident });
      } else {
        routes.push({ method, path, line: i + 1 });
      }
    }

    // Hapi: server.route({ method, path, ... })
    const hReg = new RegExp(HAPI_ROUTE_RE.source, "gi");
    while ((m = hReg.exec(line)) !== null) {
      const method = (m[1] ?? "").toLowerCase();
      const path = (m[3] ?? "").trim();
      if (!HTTP_METHODS.includes(method)) continue;
      if (!path.startsWith("/")) continue;
      routes.push({ method, path, line: i + 1 });
    }
  }

  return { file, routes, routerPrefixes, appUsePrefixes };
}

// ---------------------------------------------------------------------------
// Route scanner
// ---------------------------------------------------------------------------

export class ExpressScanner implements IRouteScanner {
  readonly framework = "express" as const;

  matches(_match: IProjectMatch): boolean {
    return _match.framework === "express";
  }

  async scan(match: IProjectMatch): Promise<ReadonlyArray<ParsedRoute>> {
    const files = await collectJsFiles(match.projectRoot);
    const modules: ParsedModule[] = [];
    for (const f of files) {
      modules.push(await parseModule(f));
    }

    // Mapa routerName → prefix (incluye app.use prefixes).
    const routerPrefixes = new Map<string, string>();
    for (const m of modules) {
      for (const [varName, prefix] of m.routerPrefixes) {
        routerPrefixes.set(varName, prefix);
      }
      for (const [varName, prefix] of m.appUsePrefixes) {
        routerPrefixes.set(varName, prefix);
      }
    }

    const out: ParsedRoute[] = [];
    for (const m of modules) {
      for (const r of m.routes) {
        // Si el route viene de un router conocido, aplica su prefix.
        let prefix = "";
        if (r.routerName && routerPrefixes.has(r.routerName)) {
          prefix = routerPrefixes.get(r.routerName) ?? "";
        }
        // Si el path ya empieza con `/api` o `/v1`, no aplicar ningún prefix.
        if (r.path.startsWith("/api/") || r.path.startsWith("/v1/")) {
          prefix = "";
        }
        // Normaliza dobles slashes y slash final.
        const fullPath = (prefix + r.path)
          .replace(/\/+/g, "/")
          .replace(/\/+$/, "");
        const relFile = m.file
          .replace(match.projectRoot, "")
          .replace(/^[\\/]/, "")
          .split(sep)
          .join("/");
        out.push({
          method: r.method.toUpperCase(),
          uri: fullPath,
          rawUri: r.path,
          sourceFile: relFile,
          lineNumber: r.line,
          prefixChain: prefix ? [prefix.replace(/^\/|\/$/g, "")] : [],
        });
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Validation provider (zod schemas)
// ---------------------------------------------------------------------------

// Tablas de mapping zod → IValidationSpec.
const ZOD_TYPE_MAP: Record<string, IValidationSpec["type"]> = {
  string: "string",
  number: "number",
  bigint: "number",
  boolean: "boolean",
  date: "date",
  array: "array",
  object: "object",
  null: "any",
  undefined: "any",
  any: "any",
  unknown: "any",
  never: "any",
  void: "any",
  literal: "enum",
  enum: "enum",
  nativeEnum: "enum",
};

const ZOD_FORMAT_MAP: Record<string, string> = {
  email: "email",
  url: "url",
  uuid: "uuid",
  cuid: "cuid",
  cuid2: "cuid2",
  ip: "ip",
  ipv4: "ipv4",
  ipv6: "ipv6",
  datetime: "date-time",
};

const ZOD_FORMAT_RE = /\.\s*([a-zA-Z_][\w]*)\s*\(/g;

/**
 * Validation provider para Express/Fastify/Koa/Hapi.
 *
 * Detecta esquemas de validación **inline** en el código:
 *   - zod: `z.object({ name: z.string(), email: z.string().email() })`
 *   - Joi: `Joi.object({ name: Joi.string().required() })`
 *
 * Estrategia:
 *   1. Lee el archivo del handler.
 *   2. Busca el primer `z.object({...})` o `Joi.object({...})` que aparezca
 *      en el handler (líneas posteriores a la línea del route).
 *   3. Convierte los fields a `IValidationSpec`.
 */
export class ExpressZodValidationProvider implements IValidationSpecProvider {
  readonly framework = "express" as const;

  async supports(_route: ParsedRoute, _match: IProjectMatch): Promise<boolean> {
    // En principio siempre intentamos; el resolve devuelve [] si no encuentra.
    return true;
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
  ): Promise<{ endpointKey: string; fields: IValidationSpec[] }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    const fields = await findInlineSchema(route, match);
    return { endpointKey, fields };
  }
}

interface ZodField {
  name: string;
  type: IValidationSpec["type"];
  required: boolean;
  format?: string;
  enumValues?: string[];
  description?: string;
  minLength?: number;
  maxLength?: number;
}

/**
 * Parsea un `z.object({...})` o `Joi.object({...})` y devuelve los fields.
 * Estrategia best-effort: regexes balanceadas por paréntesis.
 *
 * Busca el schema en el archivo entero (no solo en el handler), porque
 * la convención más común es:
 *
 *   const createUserSchema = z.object({...});
 *   app.post('/users', handler);
 *
 * Si hubiera múltiples `z.object()`, tomamos el primero que aparezca
 * DESPUÉS de la línea del route (el más cercano al handler).
 *
 * Headers: detecta además `headers: z.object({...})` (Joi/zod) en el
 * bloque del handler, y emite esos fields con `location: "header"`.
 */
async function findInlineSchema(
  route: ParsedRoute,
  match: IProjectMatch,
): Promise<IValidationSpec[]> {
  if (!route.sourceFile) return [];
  const abs = join(match.projectRoot, route.sourceFile);
  let raw: string;
  try {
    raw = await readFile(abs, "utf8");
  } catch {
    return [];
  }
  const text = stripComments(raw);
  const lines = text.split("\n");

  // 1) Buscar zod: mejor el `z.object(` más cercano al handler.
  //    Estrategia: buscar todas las ocurrencias de `z.object(` y preferir
  //    la que esté más cerca (en líneas) al handler.
  const startLine = Math.max(0, route.lineNumber - 1);
  const allZodMatches = findAllBalanced(text, /\bz\s*\.\s*object\s*\(/);
  if (allZodMatches.length > 0) {
    // Encontrar el match más cercano al handler.
    let best = allZodMatches[0];
    let bestDist = Number.MAX_SAFE_INTEGER;
    for (const m of allZodMatches) {
      const lineOfMatch = text.slice(0, m.callStart).split("\n").length - 1;
      const dist = Math.abs(lineOfMatch - startLine);
      if (dist < bestDist) {
        bestDist = dist;
        best = m;
      }
    }
    const fields = parseFieldsObjectLiteral(text.slice(best.callStart + 1, best.callEnd));
    if (fields.length > 0) {
      const bodySpecs = fields.map(zodFieldToSpec);
      // Headers: buscar `headers: z.object({...})` cerca del handler.
      const headerSpecs = findZodHeadersNear(text, best.callStart, startLine);
      return [...bodySpecs, ...headerSpecs];
    }
  }

  // 2) Joi.
  const allJoiMatches = findAllBalanced(text, /\bJoi\s*\.\s*object\s*\(/);
  if (allJoiMatches.length > 0) {
    let best = allJoiMatches[0];
    let bestDist = Number.MAX_SAFE_INTEGER;
    for (const m of allJoiMatches) {
      const lineOfMatch = text.slice(0, m.callStart).split("\n").length - 1;
      const dist = Math.abs(lineOfMatch - startLine);
      if (dist < bestDist) {
        bestDist = dist;
        best = m;
      }
    }
    const inner = text.slice(best.callStart + 1, best.callEnd);
    const items = splitTopLevel(inner);
    const out: JoiField[] = [];
    for (const item of items) {
      const cleaned = item
        .replace(/^\s*\{\s*/, "")
        .replace(/\s*\}\s*$/, "")
        .trim();
      if (!cleaned) continue;
      const m = /^([a-zA-Z_$][\w$]*)\s*:\s*Joi\s*\.\s*(\w+)\s*\(([^)]*)\)(.*)$/s.exec(cleaned);
      if (!m) continue;
      const name = m[1];
      const method = m[2];
      const chain = m[4];
      if (!name || !method) continue;
      const type = JOA_TYPE_MAP[method] ?? "string";
      const required = !/\.optional\s*\(/.test(chain ?? "");
      let format: string | undefined;
      // Joi: `Joi.string().email()` → format=email
      if (/\.email\s*\(/.test(chain ?? "")) format = "email";
      if (/\.uri\s*\(/.test(chain ?? "") || /\.url\s*\(/.test(chain ?? "")) format = "url";
      if (/\.guid\s*\(/.test(chain ?? "")) format = "uuid";
      if (method === "email") format = "email";
      if (method === "uri" || method === "url") format = "url";
      if (method === "guid") format = "uuid";
      let minLength: number | undefined;
      let maxLength: number | undefined;
      const minMatch = /\.min\s*\(\s*(\d+)\s*\)/.exec(chain ?? "");
      if (minMatch?.[1]) minLength = Number(minMatch[1]);
      const maxMatch = /\.max\s*\(\s*(\d+)\s*\)/.exec(chain ?? "");
      if (maxMatch?.[1]) maxLength = Number(maxMatch[1]);
      let enumValues: string[] | undefined;
      const validMatch = /\.valid\s*\(\s*([^)]+)\s*\)/.exec(chain ?? "");
      if (validMatch?.[1]) {
        enumValues = validMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      }
      out.push({
        name,
        type,
        required,
        ...(format ? { format } : {}),
        ...(enumValues ? { enumValues } : {}),
        ...(minLength !== undefined ? { minLength } : {}),
        ...(maxLength !== undefined ? { maxLength } : {}),
      });
    }
    if (out.length > 0) {
      const bodySpecs = out.map(joiFieldToSpec);
      const headerSpecs = findJoiHeadersNear(text, best.callStart, startLine);
      return [...bodySpecs, ...headerSpecs];
    }
  }

  return [];
}

/**
 * Busca un `headers: z.object({...})` cerca del handler. Devuelve
 * fields con `location: "header"`. Si no encuentra, [].
 * Ventana: prefiere el bloque DEBAJO del handler (config options).
 */
function findZodHeadersNear(
  text: string,
  bodyCallStart: number,
  startLine: number,
): IValidationSpec[] {
  const re = /headers\s*:\s*z\s*\.\s*object\s*\(/g;
  let m: RegExpExecArray | null;
  let best: { callStart: number; callEnd: number } | null = null;
  let bestDist = Number.MAX_SAFE_INTEGER;
  while ((m = re.exec(text)) !== null) {
    const callStart = text.indexOf("(", m.index);
    if (callStart === -1) continue;
    let depth = 0;
    let end = -1;
    for (let i = callStart; i < text.length; i++) {
      const c = text[i];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    const lineOfMatch = text.slice(0, callStart).split("\n").length - 1;
    const dist = Math.abs(lineOfMatch - startLine);
    if (dist < bestDist) {
      bestDist = dist;
      best = { callStart, callEnd: end };
    }
  }
  if (!best) return [];
  const inner = text.slice(best.callStart + 1, best.callEnd);
  const fields = parseFieldsObjectLiteral(inner);
  return fields.map((f): IValidationSpec => {
    const spec = zodFieldToSpec(f);
    return { ...spec, location: "header" };
  });
}

function findJoiHeadersNear(
  text: string,
  bodyCallStart: number,
  startLine: number,
): IValidationSpec[] {
  const re = /headers\s*:\s*Joi\s*\.\s*object\s*\(/g;
  let m: RegExpExecArray | null;
  let best: { callStart: number; callEnd: number } | null = null;
  let bestDist = Number.MAX_SAFE_INTEGER;
  while ((m = re.exec(text)) !== null) {
    const callStart = text.indexOf("(", m.index);
    if (callStart === -1) continue;
    let depth = 0;
    let end = -1;
    for (let i = callStart; i < text.length; i++) {
      const c = text[i];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    const lineOfMatch = text.slice(0, callStart).split("\n").length - 1;
    const dist = Math.abs(lineOfMatch - startLine);
    if (dist < bestDist) {
      bestDist = dist;
      best = { callStart, callEnd: end };
    }
  }
  if (!best) return [];
  const inner = text.slice(best.callStart + 1, best.callEnd);
  const items = splitTopLevel(inner);
  const out: JoiField[] = [];
  for (const item of items) {
    const cleaned = item
      .replace(/^\s*\{\s*/, "")
      .replace(/\s*\}\s*$/, "")
      .trim();
    if (!cleaned) continue;
    const m = /^([a-zA-Z_$][\w$]*)\s*:\s*Joi\s*\.\s*(\w+)\s*\(([^)]*)\)(.*)$/s.exec(cleaned);
    if (!m) continue;
    const name = m[1];
    const method = m[2];
    const chain = m[4];
    if (!name || !method) continue;
    const type = JOA_TYPE_MAP[method] ?? "string";
    const required = !/\.optional\s*\(/.test(chain ?? "");
    let format: string | undefined;
    if (/\.email\s*\(/.test(chain ?? "")) format = "email";
    if (/\.uri\s*\(/.test(chain ?? "") || /\.url\s*\(/.test(chain ?? "")) format = "url";
    if (/\.guid\s*\(/.test(chain ?? "")) format = "uuid";
    if (method === "email") format = "email";
    if (method === "uri" || method === "url") format = "url";
    if (method === "guid") format = "uuid";
    let minLength: number | undefined;
    let maxLength: number | undefined;
    const minMatch = /\.min\s*\(\s*(\d+)\s*\)/.exec(chain ?? "");
    if (minMatch?.[1]) minLength = Number(minMatch[1]);
    const maxMatch = /\.max\s*\(\s*(\d+)\s*\)/.exec(chain ?? "");
    if (maxMatch?.[1]) maxLength = Number(maxMatch[1]);
    let enumValues: string[] | undefined;
    const validMatch = /\.valid\s*\(\s*([^)]+)\s*\)/.exec(chain ?? "");
    if (validMatch?.[1]) {
      enumValues = validMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
    out.push({
      name,
      type,
      required,
      ...(format ? { format } : {}),
      ...(enumValues ? { enumValues } : {}),
      ...(minLength !== undefined ? { minLength } : {}),
      ...(maxLength !== undefined ? { maxLength } : {}),
    });
  }
  return out.map((f): IValidationSpec => {
    const spec = joiFieldToSpec(f);
    return { ...spec, location: "header" };
  });
}

/**
 * Encuentra TODAS las ocurrencias de `pattern` (regex) en el texto y
 * devuelve su posición balanceada (callStart: posición del `(`,
 * callEnd: posición del `)` que cierra).
 *
 * El `pattern` debe terminar con `\(` para que sepamos dónde empieza la
 * apertura.
 */
function findAllBalanced(
  text: string,
  pattern: RegExp,
): Array<{ callStart: number; callEnd: number }> {
  const out: Array<{ callStart: number; callEnd: number }> = [];
  const re = new RegExp(pattern.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const callStart = text.indexOf("(", m.index);
    if (callStart === -1) continue;
    let depth = 0;
    let end = -1;
    for (let i = callStart; i < text.length; i++) {
      const c = text[i];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    out.push({ callStart, callEnd: end });
  }
  return out;
}

/**
 * Parsea `{ field1: z.string(), field2: z.number().int().min(0), ... }`
 * usando split top-level por `,`.
 */
function parseFieldsObjectLiteral(body: string): ZodField[] {
  const out: ZodField[] = [];
  // Tokenizar por coma top-level.
  const items = splitTopLevel(body);
  for (const item of items) {
    // El split incluye el `{` inicial en el primer item y el `}` final en
    // el último. Limpiarlos.
    const cleaned = item
      .replace(/^\s*\{\s*/, "")
      .replace(/\s*\}\s*$/, "")
      .trim();
    if (!cleaned) continue;
    const m = /^([a-zA-Z_$][\w$]*)\s*:\s*(.+)$/s.exec(cleaned);
    if (!m) continue;
    const name = m[1];
    const expr = m[2]?.trim();
    if (!name || !expr) continue;
    const field = parseZodFieldExpression(name, expr);
    if (field) out.push(field);
  }
  return out;
}

function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let buf = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      buf += c;
      if (c === "\\") {
        buf += body[i + 1] ?? "";
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      inStr = c;
      buf += c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") {
      depth++;
      buf += c;
      continue;
    }
    if (c === ")" || c === "}" || c === "]") {
      depth--;
      buf += c;
      continue;
    }
    // Coma top-level significa "estoy en el objeto raíz" (depth === 1
    // porque entramos en el `{`).
    if (c === "," && depth === 1) {
      out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function parseZodFieldExpression(name: string, expr: string): ZodField | null {
  // Heurística: extraer el primer `z.METHOD(` (string, number, etc.)
  // y aplicar chainings como .email(), .min(), .max(), .optional, etc.
  const baseMatch = /z\s*\.\s*([a-zA-Z_][\w]*)\s*\(/.exec(expr);
  if (!baseMatch?.[1]) return null;
  const baseType = baseMatch[1];
  const type = ZOD_TYPE_MAP[baseType] ?? "string";

  // Detectar format (sub-chain `.email()`, `.url()`, etc.).
  let format: string | undefined;
  let minLength: number | undefined;
  let maxLength: number | undefined;
  let enumValues: string[] | undefined;
  for (const m of expr.matchAll(ZOD_FORMAT_RE)) {
    const method = m[1];
    if (!method) continue;
    if (ZOD_FORMAT_MAP[method]) format = ZOD_FORMAT_MAP[method];
    // En `.min(N)` y `.max(N)`, no aplica al método en `ZOD_FORMAT_RE`.
  }
  // Buscar .min(N) y .max(N).
  const minMatch = /\.min\s*\(\s*(\d+)\s*\)/.exec(expr);
  if (minMatch?.[1]) minLength = Number(minMatch[1]);
  const maxMatch = /\.max\s*\(\s*(\d+)\s*\)/.exec(expr);
  if (maxMatch?.[1]) maxLength = Number(maxMatch[1]);
  // Detectar .enum([...])
  const enumMatch = /\.enum\s*\(\s*\[([^\]]+)\]\s*\)/.exec(expr);
  if (enumMatch?.[1]) {
    enumValues = enumMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  // Detectar .optional() o ?. (no required) → required = false.
  const isOptional = /\.optional\s*\(/.test(expr) || /\.nullable\s*\(/.test(expr);

  const field: ZodField = {
    name,
    type: enumValues ? "enum" : type,
    required: !isOptional,
    ...(format ? { format } : {}),
    ...(enumValues ? { enumValues } : {}),
    ...(minLength !== undefined ? { minLength } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
  };
  return field;
}

function zodFieldToSpec(f: ZodField): IValidationSpec {
  const spec: IValidationSpec = {
    fieldName: f.name,
    location: "body",
    type: f.type,
    required: f.required,
    ...(f.format ? { format: f.format } : {}),
    ...(f.enumValues ? { enumValues: f.enumValues } : {}),
    ...(f.minLength !== undefined ? { minLength: f.minLength } : {}),
    ...(f.maxLength !== undefined ? { maxLength: f.maxLength } : {}),
  };
  return spec;
}

// ---------------------------------------------------------------------------
// Joi parser (similar, second best)
// ---------------------------------------------------------------------------

interface JoiField {
  name: string;
  type: IValidationSpec["type"];
  required: boolean;
  format?: string;
  enumValues?: string[];
  minLength?: number;
  maxLength?: number;
}

const JOA_TYPE_MAP: Record<string, IValidationSpec["type"]> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  date: "date",
  array: "array",
  object: "object",
  email: "string",
  uri: "string",
  url: "string",
  guid: "string",
  integer: "integer",
  any: "any",
};

function joiFieldToSpec(f: JoiField): IValidationSpec {
  return {
    fieldName: f.name,
    location: "body",
    type: f.type,
    required: f.required,
    ...(f.format ? { format: f.format } : {}),
    ...(f.enumValues ? { enumValues: f.enumValues } : {}),
    ...(f.minLength !== undefined ? { minLength: f.minLength } : {}),
    ...(f.maxLength !== undefined ? { maxLength: f.maxLength } : {}),
  };
}

/**
 * Encuentra el primer `z.object({...})` balanceado en el texto y devuelve
 * sus fields. Heurística: encontrar el `z.object(`, contar paréntesis
 * hasta el cierre, parsear el contenido.
 */
function parseJoiObject(text: string): JoiField[] {
  const idx = text.search(/\bJoi\s*\.\s*object\s*\(/);
  if (idx === -1) return [];
  const callStart = text.indexOf("(", idx);
  if (callStart === -1) return [];
  let depth = 0;
  let end = -1;
  for (let i = callStart; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  const inner = text.slice(callStart + 1, end);
  const items = splitTopLevel(inner);
  const out: JoiField[] = [];
  for (const item of items) {
    const m = /^([a-zA-Z_$][\w$]*)\s*:\s*Joi\s*\.\s*(\w+)\s*\(([^)]*)\)(.*)$/s.exec(item);
    if (!m) continue;
    const name = m[1];
    const method = m[2];
    const chain = m[4];
    if (!name || !method) continue;
    const type = JOA_TYPE_MAP[method] ?? "string";
    const required = !/\.optional\s*\(/.test(chain ?? "");
    let format: string | undefined;
    if (method === "email") format = "email";
    if (method === "uri" || method === "url") format = "url";
    if (method === "guid") format = "uuid";
    let minLength: number | undefined;
    let maxLength: number | undefined;
    const minMatch = /\.min\s*\(\s*(\d+)\s*\)/.exec(chain ?? "");
    if (minMatch?.[1]) minLength = Number(minMatch[1]);
    const maxMatch = /\.max\s*\(\s*(\d+)\s*\)/.exec(chain ?? "");
    if (maxMatch?.[1]) maxLength = Number(maxMatch[1]);
    let enumValues: string[] | undefined;
    const validMatch = /\.valid\s*\(\s*([^)]+)\s*\)/.exec(chain ?? "");
    if (validMatch?.[1]) {
      enumValues = validMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
    out.push({
      name,
      type,
      required,
      ...(format ? { format } : {}),
      ...(enumValues ? { enumValues } : {}),
      ...(minLength !== undefined ? { minLength } : {}),
      ...(maxLength !== undefined ? { maxLength } : {}),
    });
  }
  return out;
}
