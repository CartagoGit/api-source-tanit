/**
 * `NextJsScanner` — implementation of `IProjectScanner` + `IRouteScanner`
 * for Next.js (App Router and Pages Router).
 *
 * Detection:
 *   - `package.json` with `dependencies.next`.
 *
 * Parsing:
 *   - **App Router** (Next.js 13+): `app/<segment>/route.ts` files with
 *     `export async function GET(request)`, `export async function POST(request)`.
 *   - **Pages Router** (legacy): `pages/api/<segment>.ts` files with
 *     `export default function handler(req, res)` and `export const config = ...`.
 *   - **Dynamic segments**: `[id]` → `:p` (path param).
 *
 * Validation:
 *   - `NextJsZodProvider` (best-effort): extracts inline zod schemas in
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
import { effectiveProjectRoot, rawProjectRoot } from "../../core/discovery/effective-project-root.helper.js";

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
  // `declaredDependencies` merges `dependencies` and `devDependencies`,
  // which is the real question: a framework declared in devDeps is
  // still the project's framework. Some scanners looked at them and
  // others didn't.
  const deps = declaredDependencies(parsed.value);
  return typeof deps.next === "string";
}

/**
 * Is the project being scanned a monorepo?
 *
 * Turbo (`turbo.json` at root) and npm/yarn/pnpm workspaces
 * (`package.json#workspaces`) are **framework-agnostic** signals:
 * they don't change which framework the project is, only confirm
 * that the root `projectRoot` is not where the framework lives.
 * That is why they live in a helper shared by the scanners that can
 * receive them (for now Next.js, per proposal f00011 S1) and not
 * in a specific one.
 *
 * The function does not throw and returns `false` if the
 * `package.json` doesn't parse — the detector already filtered that
 * possibility, but reading the field raw would leave an `any`
 * floating around.
 */
function hasMonorepoMarkers(projectRoot: string): boolean {
  if (existsSync(join(projectRoot, "turbo.json"))) return true;
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return false;
  const parsed = parseJsonSafe(pkgPath);
  if (!parsed) return false;
  // `workspaces` can be an array (classic npm/yarn) or an object with
  // `packages` (yarn/pnpm). Either counts.
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
 * Local variant of `parseJson` that returns `null` on any failure.
 *
 * The scanner already went through `isNextJsProject` and knows the
 * `package.json` exists and parses — here we only want the value of
 * the `workspaces` field, so a parse failure is treated as "absent".
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
 * Lockfiles present in `projectRoot` as bonus runtime signals.
 *
 * f00011 S4: `pnpm-lock.yaml` and Bun lockfiles **refine** the
 * confidence of a detector that already recognised the framework.
 * They don't introduce it — a `pnpm-lock.yaml` without a declared
 * `next` is still `score: 0`. That's why the weights are small:
 * +0.1 (pnpm) and +0.15 (bun). The cap at 1 that `withEvidence`
 * applies to the final score absorbs the case where the signal
 * arrives at a detector already at the top (a complete Next.js still
 * marks 1, not 1.1).
 *
 * It lives here rather than in a shared helper because each scanner
 * decides what to do with the signal (Next.js accumulates it; others
 * could filter it by runtime). The pattern is the same as
 * `honoDeps()` or `dependsOnFastify()`: local helper, contract in
 * `contracts/`.
 *
 * x00035 S1: Bun ≥ 1.2 emits `bun.lock` (text) and Bun < 1.2 emits
 * `bun.lockb` (binary). Both are accepted; if both are present
 * (degenerate case, modern project with a stale binary lock), the
 * modern `bun.lock` wins and `bun.lockb` is ignored.
 */
function lockfileSignals(projectRoot: string): Array<{ signal: string; weight: number; artifact?: string }> {
  const out: Array<{ signal: string; weight: number; artifact?: string }> = [];
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) {
    out.push({ signal: "pnpm-lock.yaml presente", weight: 0.1, artifact: "pnpm-lock.yaml" });
  }
  if (existsSync(join(projectRoot, "bun.lock"))) {
    out.push({ signal: "bun.lock presente", weight: 0.15, artifact: "bun.lock" });
  } else if (existsSync(join(projectRoot, "bun.lockb"))) {
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
    // f00011 S1: `next.config.*` alone was already 0.2 (it might be from a
    // project that only uses Next as a bundler, without routes). The
    // proposal raises the weight to 0.5 when there is also a real router
    // (App/Pages). Without a router, the weight stays at 0.2 — it
    // avoids inflating the score in projects where next is just an
    // auxiliary dependency.
    if (hasNextConfig) {
      signals.push({
        signal: hasRouter
          ? "next.config.* presente (con App/Pages Router)"
          : "next.config.* presente",
        weight: hasRouter ? 0.5 : 0.2,
        ...(hasNextConfig ? {} : {}),
      });
    }
    // f00011 S1: framework-agnostic monorepo signals. If the root
    // `package.json` declares workspaces or there is a `turbo.json`,
    // the framework may live in a subdir — it's worth bumping the
    // score 0.1 to push the orchestrator to apply `frameworkSearchRoot`.
    // Without this hint, a Next.js in `apps/web/` came out with score
    // 0.5 because the root manifest never had `next as direct
    // dependency.
    if (hasMonorepoMarkers(projectRoot)) {
      signals.push({
        signal: "monorepo (turbo.json o workspaces)",
        weight: 0.1,
        artifact: "package.json",
      });
    }
    // f00011 S4: lockfile as runtime bonus. Added at the end so a
    // lockfile can't mask an absent framework — the signal only
    // contributes when the detector was already convinced.
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
    // f00011 S1: in monorepos the host passes `frameworkSearchRoot`
    // (e.g. `"apps/web"`) and the scanner looks there instead of at
    // the root. Without this, a Next.js project inside `apps/web/`
    // came out with zero routes because `app/` and `pages/` live in
    // the subdir.
    const projectRoot = effectiveProjectRoot(match);
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
  // Audit 2026-09-06 §17, proposal r00015: when the scanner emits
  // MORE than one verb for the same URI from a Pages Router
  // handler, it is because the same handler dispatches by
  // `req.method` — there is no static signal for which verb the
  // caller actually uses. Mark every emitted route `confidence:
  // "low"` with a human-readable reason so the user sees it in
  // Postman / OpenAPI. The single-verb path stays `high` (the
  // default) because `req.method === "GET"` is a real signal.
  const multiVerb = methods.size > 1;
  for (const method of methods) {
    out.push({
      method,
      uri: routePath,
      rawUri: routePath,
      sourceFile: relPath,
      lineNumber: 0,
      prefixChain: [],
      displayName: `${method} ${routePath}`,
      ...(multiVerb
        ? {
            confidence: {
              level: "low" as const,
              reasons: [
                "Pages Router handler method dispatch not statically resolved",
                `${methods.size} verbs emitted from one \`switch (req.method)\` block`,
              ],
            },
          }
        : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation spec provider — zod inline in the route handler
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
      raw = await readFile(join(rawProjectRoot(match), route.sourceFile), "utf8");
    } catch {
      return { endpointKey, fields: [] };
    }

    // An App Router `route.ts` groups several methods in one file, so
    // we pick the `z.object()` closest to THIS method's handler
    // rather than the first one in the file.
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
 * Line (0-based) where the given method's exported handler starts.
 * Returns 0 if not found, which means means "use the first schema".
 */
function findHandlerLine(text: string, method: string): number {
  const re = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${method.toUpperCase()}\\s*\\(`,
  );
  const m = re.exec(text);
  return m ? countLinesBefore(text, m.index) : 0;
}
