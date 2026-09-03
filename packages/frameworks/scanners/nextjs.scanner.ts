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
import { existsSync, readFileSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { ownRegex } from "../../core/helpers/regex.helper.js";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { declaredDependencies, parseJson } from "../../core/helpers/parse-json.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";
import { countLinesBefore, findNearestBalanced, stripJsComments } from "../../core/helpers/source-scan.helper.js";
import { parseZodObjectLiteral, zodFieldToSpec } from "../parsers/zod-schema.helper.js";

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
  const parsed = parseJson(raw);
  if (!parsed.ok) return false;
  // `declaredDependencies` funde `dependencies` y `devDependencies`, que
  // es la pregunta que se hace de verdad: un framework declarado en las
  // de desarrollo sigue siendo el framework del proyecto. Unos scanners
  // las miraban y otros no.
  const deps = declaredDependencies(parsed.value);
  return typeof deps.next === "string";
}

/**
 * Devuelve la raíz efectiva donde este scanner mira sus señales.
 *
 * Si el `IProjectMatch` lleva `frameworkSearchRoot` (el host lo rellenó
 * tras detectar monorepo), se une con `projectRoot`. En monorepos el
 * `package.json` raíz es el del workspace y el `next.config.*` vive en
 * `apps/web/` — sin este salto, el detector miraba donde no tocaba y el
 * scan salía vacío. Si el campo está ausente, se devuelve `projectRoot`
 * sin modificar (compatibilidad con los proyectos planos).
 *
 * Función pura: vive aquí en vez de en `core/helpers/` para no abrir
 * un módulo nuevo por una sola función. La usan los tres scanners que
 * tocan f00011 S1.
 */
function effectiveSearchRoot(match: IProjectMatch): string {
  return match.frameworkSearchRoot
    ? join(match.projectRoot, match.frameworkSearchRoot)
    : match.projectRoot;
}

/**
 * ¿El proyecto donde se mira es un monorepo?
 *
 * Turbo (`turbo.json` en raíz) y npm/yarn/pnpm workspaces
 * (`package.json#workspaces`) son señales **agnósticas del framework**:
 * no cambian qué framework es el proyecto, solo confirman que el
 * `projectRoot` raíz no es donde vive el framework. Por eso viven en un
 * helper compartido por los scanners que pueden recibirlas (de momento
 * Next.js, por la propuesta f00011 S1) y no en uno concreto.
 *
 * La función no lanza y devuelve `false` si el `package.json` no
 * parsea — el detector ya filtró esa posibilidad, pero leer el campo en
 * crudo dejaría un `any` pululando.
 */
function hasMonorepoMarkers(projectRoot: string): boolean {
  if (existsSync(join(projectRoot, "turbo.json"))) return true;
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return false;
  const parsed = parseJsonSafe(pkgPath);
  if (!parsed) return false;
  // `workspaces` puede ser un array (npm/yarn clásico) o un objeto con
  // `packages` (yarn/pnpm). Cualquiera de los dos cuenta.
  const ws = parsed["workspaces"];
  if (Array.isArray(ws) && ws.length > 0) return true;
  if (
    typeof ws === "object" &&
    ws !== null &&
    Array.isArray((ws as Record<string, unknown>)["packages"]) &&
    ((ws as Record<string, unknown>)["packages"] as unknown[]).length > 0
  ) {
    return true;
  }
  return false;
}

/**
 * Variante local de `parseJson` que devuelve `null` cuando algo falla.
 *
 * El scanner ya pasó por `isNextJsProject` y sabe que el `package.json`
 * existe y parsea — aquí solo queremos el valor del campo
 * `workspaces`, así que un fallo de parse se trata como "ausencia".
 */
function parseJsonSafe(pkgPath: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = readFileSync(pkgPath, "utf8");
  } catch {
    return null;
  }
  const parsed = parseJson(raw);
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
    return null;
  }
  return parsed.value as Record<string, unknown>;
}

/**
 * Lockfiles presentes en `projectRoot` como señales bonus de runtime.
 *
 * f00011 S4: `pnpm-lock.yaml` y `bun.lockb` **afinan** la confianza de
 * un detector que ya reconoció el framework. No la introducen — un
 * `pnpm-lock.yaml` sin `next` declarado sigue siendo `score: 0`—. Por
 * eso los pesos son pequeños: +0.1 (pnpm) y +0.15 (bun). El cap a 1
 * que el `withEvidence` aplica al score final absorbe el caso en el
 * que la señal llega a un detector que ya estaba al tope (un Next.js
 * completo sigue marcando 1, no 1.1).
 *
 * Vive aquí en vez de en un helper compartido porque cada scanner
 * decide qué hace con la señal (Next.js la acumula; otros podrían
 * filtrarla por runtime). El patrón es el mismo que `honoDeps()` o
 * `dependsOnFastify()`: helper local, contrato en `contracts/`.
 */
function lockfileSignals(projectRoot: string): Array<{ signal: string; weight: number; artifact?: string }> {
  const out: Array<{ signal: string; weight: number; artifact?: string }> = [];
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) {
    out.push({ signal: "pnpm-lock.yaml presente", weight: 0.1, artifact: "pnpm-lock.yaml" });
  }
  if (existsSync(join(projectRoot, "bun.lockb"))) {
    out.push({ signal: "bun.lockb presente", weight: 0.15, artifact: "bun.lockb" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export class NextJsProjectScanner implements IProjectScanner {
  readonly framework = "nextjs" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const isNext = await isNextJsProject(projectRoot);
    if (!isNext) return emptyResult(0);
    const hasApp = existsSync(join(projectRoot, "app"));
    const hasPages = existsSync(join(projectRoot, "pages"));
    const hasSrcApp = existsSync(join(projectRoot, "src", "app"));
    const hasSrcPages = existsSync(join(projectRoot, "src", "pages"));
    const hasNextConfig =
      existsSync(join(projectRoot, "next.config.js")) ||
      existsSync(join(projectRoot, "next.config.mjs")) ||
      existsSync(join(projectRoot, "next.config.ts"));
    const hasRouter = hasApp || hasSrcApp || hasPages || hasSrcPages;
    const signals: Array<{ signal: string; weight: number; artifact?: string }> = [
      { signal: "next declarado como dependencia", weight: 0.5, artifact: "package.json" },
    ];
    if (hasApp || hasSrcApp) signals.push({ signal: "App Router presente", weight: 0.4, artifact: "app/" });
    if (hasPages || hasSrcPages) signals.push({ signal: "Pages Router presente", weight: 0.4, artifact: "pages/" });
    // f00011 S1: `next.config.*` por sí solo ya era 0.2 (puede ser de un
    // proyecto que solo usa Next como bundler, sin rutas). La propuesta
    // sube el peso a 0.5 cuando además hay un router real (App/Pages).
    // Sin router, el peso se queda en 0.2 — evita inflar el score en
    // proyectos donde next es solo una dependencia auxiliar.
    if (hasNextConfig) {
      signals.push({
        signal: hasRouter
          ? "next.config.* presente (con App/Pages Router)"
          : "next.config.* presente",
        weight: hasRouter ? 0.5 : 0.2,
        ...(hasNextConfig ? {} : {}),
      });
    }
    // f00011 S1: señales agnósticas de monorepo. Si el `package.json`
    // raíz declara workspaces o hay `turbo.json`, el framework puede
    // vivir en un subdir — vale subir el score 0.1 para empujar al
    // orquestador a aplicar `frameworkSearchRoot`. Sin esta pista, un
    // Next.js en `apps/web/` salía con score 0.5 porque el manifiesto
    // raíz nunca tenía `next` como dependencia directa.
    if (hasMonorepoMarkers(projectRoot)) {
      signals.push({
        signal: "monorepo (turbo.json o workspaces)",
        weight: 0.1,
        artifact: "package.json",
      });
    }
    // f00011 S4: lockfile como bonus de runtime. Sumamos al final para
    // que un lockfile no pueda tapar una ausencia de framework — la
    // señal solo aporta cuando el detector ya estaba convencido.
    for (const lock of lockfileSignals(projectRoot)) signals.push(lock);
    return withEvidence(signals.reduce((a, s) => a + s.weight, 0), signals);
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

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const out: ParsedRoute[] = [];
    // f00011 S1: en monorepos el host pasa `frameworkSearchRoot`
    // (ej. `"apps/web"`) y el scanner mira ahí en vez de en la raíz.
    // Sin esto, un proyecto Next.js dentro de `apps/web/` salía con
    // cero rutas porque `app/` y `pages/` viven en el subdir.
    const projectRoot = effectiveSearchRoot(match);
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
    return { routes: out };
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
  let m: RegExpExecArray | null;
  const appRouteRe = ownRegex(APP_ROUTE_RE);
  while ((m = appRouteRe.exec(raw)) !== null) {
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
  const hasHandler = PAGE_HANDLER_RE.test(raw);
  if (!hasHandler) return out;
  const methods = new Set<string>();
  for (const methodMatch of raw.matchAll(
    /(?:req\.method|request\.method)\s*(?:===|!==|==|!=)\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']/gi,
  )) {
    methods.add((methodMatch[1] ?? "").toUpperCase());
  }
  for (const methodMatch of raw.matchAll(
    /case\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']\s*:/gi,
  )) {
    methods.add((methodMatch[1] ?? "").toUpperCase());
  }
  if (methods.size === 0) methods.add("GET");
  for (const method of methods) {
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

export class NextJsZodProvider implements IValidationSpecProvider {  readonly framework = "nextjs" as const;

  async supports(
    _r: ParsedRoute,
    _m: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<boolean> {
    return true;
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
    _scanResult: IScanResult,
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
