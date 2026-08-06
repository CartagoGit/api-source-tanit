/**
 * `NextJsScanner` — implementación de `IProjectScanner` + `IRouteScanner`
 * para Next.js (App Router y Pages Router).
 *
 * Detección:
 *   - `package.json` con `dependencies.next`.
 *
 * Parsing:
 *   - **App Router** (Next.js 13+): archivos `app/<segment>/route.ts` con
 *     `export async function GET(request)`, `export async function POST(request)`.
 *   - **Pages Router** (legacy): archivos `pages/api/<segment>.ts` con
 *     `export default function handler(req, res)` y `export const config = ...`.
 *   - **Dynamic segments**: `[id]` → `:p` (path param).
 *
 * Validation:
 *   - `NextJsZodProvider` (best-effort): extrae zod schemas inline en
 *     route handlers (`const schema = z.object({...})`).
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contracts/scanner.interface.js";
import {
  countLinesBefore,
  findNearestBalanced,
  stripJsComments,
} from "../../helpers/source-scan.helper.js";
import { parseZodObjectLiteral, zodFieldToSpec } from "../../frameworks/parsers/zod-schema.helper.js";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"];

async function isNextJsProject(projectRoot: string): Promise<boolean> {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return false;
  let raw: string;
  try {
    raw = await readFile(pkgPath, "utf8");
  } catch {
    return false;
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  const deps = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
  return typeof deps.next === "string";
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export class NextJsProjectScanner implements IProjectScanner {
  readonly framework = "nextjs" as const;

  async detect(projectRoot: string): Promise<number> {
    const isNext = await isNextJsProject(projectRoot);
    if (!isNext) return 0;
    const hasApp = existsSync(join(projectRoot, "app"));
    const hasPages = existsSync(join(projectRoot, "pages"));
    if (hasApp || hasPages) return 1;
    const hasSrcApp = existsSync(join(projectRoot, "src", "app"));
    const hasSrcPages = existsSync(join(projectRoot, "src", "pages"));
    if (hasSrcApp || hasSrcPages) return 1;
    return 0.5;
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const artifacts: string[] = ["package.json"];
    if (existsSync(join(projectRoot, "app"))) artifacts.push("app");
    if (existsSync(join(projectRoot, "pages"))) artifacts.push("pages");
    if (existsSync(join(projectRoot, "src", "app"))) artifacts.push("src/app");
    if (existsSync(join(projectRoot, "src", "pages"))) artifacts.push("src/pages");
    return { framework: "nextjs", projectRoot, artifacts };
  }
}

// ---------------------------------------------------------------------------
// Route scanner
// ---------------------------------------------------------------------------

/**
 * App Router: `export async function GET(request: Request) { ... }`.
 */
const APP_ROUTE_RE = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(/g;

/**
 * Pages Router: `export default function handler(req, res) { ... }`.
 */
const PAGE_HANDLER_RE = /export\s+default\s+function\s+([a-zA-Z_][\w]*)\s*\(\s*req/;

export class NextJsRouteScanner implements IRouteScanner {
  readonly framework = "nextjs" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "nextjs";
  }

  async scan(match: IProjectMatch): Promise<ParsedRoute[]> {
    const out: ParsedRoute[] = [];
    const projectRoot = match.projectRoot;
    // 1) App Router.
    for (const base of ["app", join("src", "app")]) {
      const dir = join(projectRoot, base);
      if (existsSync(dir)) {
        await walkRouteTs(dir, projectRoot, out, "");
      }
    }
    // 2) Pages Router.
    for (const base of ["pages/api", join("src", "pages", "api")]) {
      const dir = join(projectRoot, base);
      if (existsSync(dir)) {
        await walkApiTs(dir, projectRoot, out, "/api");
      }
    }
    return out;
  }
}

async function walkRouteTs(
  dir: string,
  projectRoot: string,
  out: ParsedRoute[],
  prefix: string,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const relPath = full.startsWith(projectRoot)
      ? full.slice(projectRoot.length + 1).split("/").join("/")
      : full;
    if (entry === "route.ts" || entry === "route.js") {
      const routePath = prefix === "" ? "/" : prefix;
      out.push(...(await parseAppRouteFile(full, relPath, routePath)));
    } else if (!entry.includes(".")) {
      // Segment dir: `[id]` → `:p`, `users` → `/users`.
      const segment = entry.startsWith("[") && entry.endsWith("]")
        ? `:${entry.slice(1, -1)}`
        : entry;
      const nextPrefix = prefix + "/" + segment;
      await walkRouteTs(full, projectRoot, out, nextPrefix);
    }
  }
}

async function walkApiTs(
  dir: string,
  projectRoot: string,
  out: ParsedRoute[],
  prefix: string,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const relPath = full.startsWith(projectRoot)
      ? full.slice(projectRoot.length + 1).split("/").join("/")
      : full;
    if ((entry.endsWith(".ts") || entry.endsWith(".js")) && !entry.endsWith(".d.ts")) {
      const base = entry.replace(/\.(ts|js)$/, "");
      const routePath = base === "index"
        ? prefix
        : `${prefix}/${base.startsWith("[") && base.endsWith("]") ? `:${base.slice(1, -1)}` : base}`;
      out.push(...(await parsePageRouteFile(full, relPath, routePath)));
    } else if (!entry.includes(".")) {
      const nextPrefix = `${prefix}/${entry}`;
      await walkApiTs(full, projectRoot, out, nextPrefix);
    }
  }
}

async function parseAppRouteFile(
  absPath: string,
  relPath: string,
  routePath: string,
): Promise<ParsedRoute[]> {
  const out: ParsedRoute[] = [];
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch {
    return [];
  }
  APP_ROUTE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = APP_ROUTE_RE.exec(raw)) !== null) {
    const method = (m[1] ?? "").toLowerCase();
    if (!HTTP_METHODS.includes(method)) continue;
    out.push({
      method: method.toUpperCase(),
      uri: routePath,
      rawUri: routePath,
      sourceFile: relPath,
      lineNumber: 0,
      prefixChain: [],
      displayName: `${method.toUpperCase()} ${routePath}`,
    });
  }
  return out;
}

async function parsePageRouteFile(
  absPath: string,
  relPath: string,
  routePath: string,
): Promise<ParsedRoute[]> {
  const out: ParsedRoute[] = [];
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch {
    return [];
  }
  // Detectar métodos desde `export const config = { api: { bodyParser: ... } }`
  // o simplemente asumir GET/POST (los handlers de Pages Router suelen aceptar ambos).
  const hasHandler = PAGE_HANDLER_RE.test(raw);
  if (!hasHandler) return out;
  // Default: soportar GET, POST, PUT, DELETE.
  for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
    out.push({
      method,
      uri: routePath,
      rawUri: routePath,
      sourceFile: relPath,
      lineNumber: 0,
      prefixChain: [],
      displayName: `${method} ${routePath}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation spec provider — zod inline en el route handler
// ---------------------------------------------------------------------------

/** `z.object(` — schema de body declarado en el propio route handler. */
const ZOD_OBJECT_RE = /\bz\s*\.\s*object\s*\(/;

export class NextJsZodProvider implements IValidationSpecProvider {
  readonly framework = "nextjs" as const;

  async supports(_r: ParsedRoute, _m: IProjectMatch): Promise<boolean> {
    return true;
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
  ): Promise<{ endpointKey: string; fields: IValidationSpec[] }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    if (!route.sourceFile) return { endpointKey, fields: [] };

    let raw: string;
    try {
      raw = await readFile(join(match.projectRoot, route.sourceFile), "utf8");
    } catch {
      return { endpointKey, fields: [] };
    }

    // Un `route.ts` de App Router agrupa varios métodos en un archivo, así
    // que elegimos el `z.object()` más cercano al handler de ESTE método
    // en lugar del primero del archivo.
    const text = stripJsComments(raw);
    const handlerLine = findHandlerLine(text, route.method);
    const call = findNearestBalanced(text, ZOD_OBJECT_RE, handlerLine);
    if (!call) return { endpointKey, fields: [] };

    const body = text.slice(call.callStart + 1, call.callEnd);
    const fields = parseZodObjectLiteral(body).map((f) => zodFieldToSpec(f));
    return { endpointKey, fields };
  }
}

/**
 * Línea (0-based) donde arranca el handler exportado del método dado.
 * Devuelve 0 si no se encuentra, que equivale a "usa el primer schema".
 */
function findHandlerLine(text: string, method: string): number {
  const re = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${method.toUpperCase()}\\s*\\(`,
  );
  const m = re.exec(text);
  return m ? countLinesBefore(text, m.index) : 0;
}
