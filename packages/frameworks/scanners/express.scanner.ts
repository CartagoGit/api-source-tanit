/**
 * `ExpressRouteScanner` — implementation of `IProjectScanner` + `IRouteScanner`
 * for Node.js frameworks: Express, Fastify, Koa-router, and Hapi.
 *
 * Detection:
 *   - `package.json` with `dependencies` or `devDependencies` containing
 *     `express`, `fastify`, `@koa/router`, `@hapi/hapi`, or `koa`.
 *   - Auto-detects the project root from `package.json`.
 *
 * Parsing:
 *   - Robust regex on `app.METHOD(path, handler)` and `router.METHOD(path, handler)`.
 *   - Supports:
 *     - Express: `app.get('/users', (req, res) => {...})`, `router.post(...)`
 *     - Fastify: `fastify.get('/users', handler)`, `app.route({...}).get(...)`
 *     - Koa: `router.get('/users', ctx => {...})`
 *     - Hapi: `server.route({ method: 'GET', path: '/users', handler: () => {...} })`
 *   - Detects `Router()` / `express.Router()` / `Router({ prefix: '/api' })`.
 *   - Collects prefixes from `app.use('/api', router)` for nested routers.
 *
 * No validation provider (these frameworks don't have a native
 * "FormRequest"); relies on `applyAgnosticInference` for heuristic
 * body/query generation.
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import { isRecord, parseJson } from "../../core/helpers/parse-json.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";
import { collectFilesFrom, isSourceJsTsFile } from "../../core/helpers/fs-walk.helper.js";
import { countLinesBefore, findAllBalanced, findNearestBalanced, stripJsComments } from "../../core/helpers/source-scan.helper.js";
import { joiFieldToSpec, parseJoiObjectLiteral } from "../parsers/joi-schema.helper.js";
import { parseZodObjectLiteral, zodFieldToSpec } from "../parsers/zod-schema.helper.js";
import type { IBalancedCall } from "../../contracts/interfaces/core/helpers.interface.js";
import { parseModuleWithProgram } from "../../core/language-frontends/typescript/index.js";
import { buildLanguageIRFromProgram } from "../typescript/build-language-ir.helper.js";
import { propagateConstants } from "../typescript/constant-propagation.helper.js";
import { toTSMethodCalls } from "../typescript/scanner-bridge.helper.js";
import type { IParseDiagnostic } from "../../contracts/interfaces/core/scanner.interface.js";
import { effectiveProjectRoot, rawProjectRoot } from "../../core/discovery/effective-project-root.helper.js";
import { SymbolGraph } from "../../core/discovery/symbol-graph.js";
import { makeSymbolId } from "../../core/discovery/symbol-id.js";

/**
 * Node frameworks this scanner covers because they look like Express.
 *
 * `fastify` was here and is gone: it has its own scanner, which reads
 * the JSON Schema Fastify declares INSIDE each route. That's exact
 * type information; this only recognises the call shape. Leaving it
 * here made a Fastify project match both, mixing two reads — one
 * good and one half.
 *
 * Koa and Hapi stay because they don't have their own scanner yet.
 */
const FRAMEWORK_PACKAGES = ["express", "@koa/router", "@hapi/hapi", "koa"];
const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"];

/**
 * Receivers that ARE the application/server instance itself and so
 * never carry a router prefix. Declared on them we treat the call as
 * a direct route (the historical `app`/`server`/`fastify`/`koa` set);
 * any other identifier is a router variable that may have a prefix.
 */
const RESERVED_RECEIVERS: ReadonlySet<string> = new Set([
  "app",
  "server",
  "fastify",
  "koa",
]);

/**
 * Lockfiles present in `projectRoot` as bonus runtime signals.
 *
 * f00011 S4: `pnpm-lock.yaml` and Bun lockfiles refine the Express
 * detector's confidence (and Koa/Hapi, which share this scanner).
 * Small weights: +0.1 (pnpm), +0.15 (bun). The final score goes
 * through `withEvidence(score, evidence)` with no cap — the detector
 * already returns 0.7–0.9 — so the bonus does move the needle in
 * these cases. The signal never masks the absence of a framework:
 * it's added at the end, after the package that already gave the
 * main detection.
 *
 * x00035 S1: Bun ≥ 1.2 emits `bun.lock` (text) and Bun < 1.2 emits
 * `bun.lockb` (binary). Both are accepted; if both are present
 * (degenerate case, modern project with a stale binary lock), the
 * modern `bun.lock` wins and `bun.lockb` is ignored.
 */
function lockfileSignals(projectRoot: string): Array<{ signal: string; weight: number; artifact: string }> {
  const out: Array<{ signal: string; weight: number; artifact: string }> = [];
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

// The multiline regexes that recognised `app.METHOD(path, handler)`,
// `Router({ prefix })` and `app.use('/prefix', router)` lived here.
// a00010 S7 replaced them with the AST produced by the TypeScript
// frontend — the shape is the same, but there are no longer false
// positives in strings and no `findOutsideStrings` is needed.

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export class ExpressProjectScanner implements IProjectScanner {
  readonly framework = "express" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const pkgPath = join(projectRoot, "package.json");
    if (!existsSync(pkgPath)) return emptyResult(0);
    const parsed = parseJson(await readFile(pkgPath, "utf8"));
    if (!parsed.ok || !isRecord(parsed.value)) return emptyResult(0);
    const deps = {
      ...((parsed.value["dependencies"] as Record<string, string>) ?? {}),
      ...((parsed.value["devDependencies"] as Record<string, string>) ?? {}),
    };
    const matches = FRAMEWORK_PACKAGES.filter(
      (name) =>
        deps[name] !== undefined ||
        Object.keys(deps).some((k) => k.startsWith(name)),
    );
    if (matches.length === 0) return emptyResult(0);
    const score = matches.reduce(
      (acc, name) =>
        deps[name] !== undefined ? Math.max(acc, 0.9) : Math.max(acc, 0.7),
      0,
    );
    // f00010 S2: the detector explains why it scored. Each match
    // (direct or by prefix) bumps the score and is noted in evidence
    // so `summary` and the UI show the traceability.
    const pkg = parsed.value;
    const evidence = matches.map((name) => {
      const inDeps = name in ((pkg["dependencies"] as Record<string, string> | undefined) ?? {});
      const where = inDeps ? "dependencies" : "devDependencies";
      return {
        signal:
          deps[name] !== undefined
            ? `package.json declares ${name} in ${where}`
            : `package.json declares ${name}* (matching-prefix package)`,
        weight: deps[name] !== undefined ? 0.9 : 0.7,
        artifact: "package.json",
      };
    });
    // f00011 S4: lockfile as runtime bonus. The base score is the
    // maximum of the weights of each match (several compatible
    // packages don't accumulate); the lockfile is added at the end
    // because it's an orthogonal signal, not a competing one.
    // Added at the end so a lockfile can't mask an absent framework —
    // `package.json` detection always goes first.
    let finalScore = score;
    for (const lock of lockfileSignals(projectRoot)) {
      evidence.push(lock);
      finalScore += lock.weight;
    }
    return withEvidence(finalScore, evidence);
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

async function collectJsFiles(projectRoot: string): Promise<string[]> {
  return collectFilesFrom(
    ["src", "lib", "app", "routes", ""].map((dir) =>
      dir ? join(projectRoot, dir) : projectRoot,
    ),
    isSourceJsTsFile,
  );
}

/**
 * Resolves the scanner's effective root honouring `frameworkSearchRoot`.
 *
 * Audit 2nd review #4: Express wasn't using `match.frameworkSearchRoot`,
 * only `match.projectRoot`. In a monorepo with two Express apps
 * (`apps/api`, `apps/admin`) and `--framework-search-root apps/api`,
 * the scanner walked the entire monorepo root and contaminated the
 * collection with routes from `apps/admin`. This function is the
 * single contract that `effectiveScanRoot` from
 * `core/discovery/scan-root.helper.ts` already defines — all scanners
 * should delegate to it.
 *
 * a00014 S2: now delegated to `effectiveProjectRoot(match)` from
 * `packages/core/discovery/effective-project-root.helper.ts`, the
 * single primitive all 21 scanners use. The local helper is kept as
 * a historic no-op so external call sites don't break, but the scanner
 * no longer uses it.
 */
function expressSearchRoot(match: IProjectMatch): string {
  return effectiveProjectRoot(match);
}

interface ParsedModule {
  file: string;
  routes: Array<{ method: string; path: string; line: number; routerName?: string }>;
  routerPrefixes: Map<string, string>; // varName → prefix
  appUsePrefixes: Map<string, string>; // varName → prefix
}

/**
 * `raw` arrives already read, this function does not read it.
 *
 * That's what lets the caller fetch files in parallel with a cap
 * instead of one after another. The alternative —leaving the read
 * inside here— forces the outer loop to wait for each disk.
 *
 * Migrated in a00010 S7 to consume the TypeScript frontend AST:
 * before, regex over the source code (with its false positives:
 * multiline, nested strings, comments), now a single AST pass produces
 * `imports`, `assignments` and `methodCalls` that the Express adapter
 * consumes.
 *
 * `diagnostics` (a00011 C-7 / B-rev-13) accumulates the files the
 * frontend couldn't parse: the function returns an empty module and
 * adds the reason to the caller's array, which elevates it to
 * `IScanResult`.
 */
function parseModuleSafe(
  file: string,
  raw: string,
  diagnostics: Array<IParseDiagnostic>,
): ParsedModule {
  // x00048 S3: single-parse. `parseModuleWithProgram` hace UN parse
  // Babel y devuelve tanto el `TSFile` del frontend (assignments,
  // decorators…) como el `Program` crudo, que alimenta
  // `buildLanguageIRFromProgram` (calls, bindings, aliases,
  // reexports). Antes: `parseModule` + `collectMethodCallsFromSource`
  // + `collectConstantsFromSource` = 3 parses por archivo.
  const parsed = parseModuleWithProgram(raw, file, diagnostics);
  if (!parsed) {
    // The reason is already recorded in `diagnostics` by the frontend:
    // the scanner keeps working, it just doesn't find routes in
    // that file.
    return { file, routes: [], routerPrefixes: new Map(), appUsePrefixes: new Map() };
  }
  const ast = parsed.tsFile;
  const routerPrefixes = new Map<string, string>();
  const appUsePrefixes = new Map<string, string>();
  const routes: Array<{ method: string; path: string; line: number; routerName?: string }> = [];

  // (1) Router prefix declarations: `const r = Router({ prefix: '/api/v1' })`.
  // The frontend returns the argument's `objectShape` (which the
  // parser unpacks from the CallExpression when it's a transparent
  // wrapper); the adapter looks for the `prefix` field here.
  for (const assignment of ast.assignments) {
    const value = assignment.value;
    if (value.kind !== "object" || !value.objectShape) continue;
    const prefixField = value.objectShape.find((p) => p.key === "prefix");
    if (!prefixField) continue;
    if (prefixField.literal.kind !== "string") continue;
    const prefix = prefixField.literal.value;
    if (typeof prefix !== "string") continue;
    routerPrefixes.set(assignment.name, prefix);
  }

  // (2) `app.use('/prefix', router)` and `app.use('/prefix')` —
  // the first mounts a router with prefix; the second is pure
  // middleware (no router to prefix).
  //
  // a00016 S5: `methodCalls` no longer comes from the TS frontend —
  // it comes from the LanguageIR pipeline (S2 + S4). The frontend
  // only provides `assignments` and `decorators`. The
  // `toTSMethodCalls` bridge converts `IRouteCallExpression[]` into
  // the `TSMethodCall[]` shape that the rest of this scanner keeps
  // consuming — without touching the extraction logic.
  //
  // x00048 S3: el LanguageIR se construye desde el MISMO `Program`
  // que parseó `parseModuleWithProgram` arriba — un solo parse por
  // archivo. Los bindings de constantes vienen en el mismo IR, así
  // que `const M = "get"; app[M](...)` se propaga sin re-parsear
  // (a00016 S6.c).
  const ir = buildLanguageIRFromProgram(parsed.program, file);
  const propagated = propagateConstants(ir.calls, ir.bindings);
  const methodCalls = toTSMethodCalls(propagated, raw);
  for (const call of methodCalls) {
    if (call.callee !== "app.use") continue;
    const prefixArg = call.args[0];
    const routerArg = call.args[1];
    if (prefixArg?.kind !== "string") continue;
    const prefix = prefixArg.value;
    if (typeof prefix !== "string") continue;
    if (routerArg?.kind !== "identifier" || typeof routerArg.identifierName !== "string") continue;
    appUsePrefixes.set(routerArg.identifierName, prefix);
  }

  // (3) Method calls that look like route declarations.
  // x00038 / a00016 S6: read the STRUCTURED `method` and `receiver`
  // the bridge forwards, instead of reconstructing them with
  // `call.callee.split(".")`. The split was a silent-loss trap:
  // `this.router.get` split to ["this","router","get"] -> verb
  // "router" (not an HTTP verb -> route dropped); `server["get"]`
  // has no dot at all -> verb undefined -> dropped. Now the verb and
  // the receiver come from the IR, so every recognised style yields a
  // route. `computedMethod` distinguishes `server["get"]` from a plain
  // router chain (we never prefix computed receivers).
  for (const call of methodCalls) {
    const verb = (call.method ?? "").toLowerCase();
    if (!verb || !HTTP_METHODS.includes(verb)) {
      continue;
    }
    const pathArg = call.args[0];
    if (pathArg?.kind !== "string") {
      continue;
    }
    const path = pathArg.value;
    if (typeof path !== "string" || !path.startsWith("/")) {
      continue;
    }
    const line = call.line;
    const receiver = call.receiver ?? "";
    if (receiver && !RESERVED_RECEIVERS.has(receiver)) {
      routes.push({ method: verb, path, line, routerName: receiver });
    } else {
      routes.push({ method: verb, path, line });
    }
  }

  // (4) Hapi: `server.route({ method: 'GET', path: '/users', ... })`.
  // Babel emits this shape as a `CallExpression` to
  // `<ident>.route(...)` with an ObjectExpression as argument. We
  // look directly in `methodCalls` for the callee.
  for (const call of methodCalls) {
    if (!call.callee.endsWith(".route")) continue;
    const obj = call.args[0];
    if (obj?.kind !== "object" || !obj.objectShape) continue;
    const methodField = obj.objectShape.find((p) => p.key === "method");
    const pathField = obj.objectShape.find((p) => p.key === "path");
    if (!methodField || !pathField) continue;
    if (methodField.literal.kind !== "string" || pathField.literal.kind !== "string") continue;
    const methodRaw = methodField.literal.value;
    const pathRaw = pathField.literal.value;
    if (typeof methodRaw !== "string" || typeof pathRaw !== "string") continue;
    const method = methodRaw.toLowerCase();
    const path = pathRaw;
    if (!HTTP_METHODS.includes(method)) continue;
    if (!path.startsWith("/")) continue;
    routes.push({ method, path, line: call.line });
  }

  return { file, routes, routerPrefixes, appUsePrefixes };
}

/**
 * Calls the frontend with `errorRecovery: true` to not break the
 * scan when a file has weird syntax. If Babel can't do anything with
 * the file, the frontend returns `null` and logs the reason in
 * `diagnostics` (a00011 C-7 / B-rev-13): the scan continues, but the
 * file doesn't disappear without a trace.
 */

// ---------------------------------------------------------------------------
// Route scanner
// ---------------------------------------------------------------------------

export class ExpressRouteScanner implements IRouteScanner {
  readonly framework = "express" as const;

  matches(_match: IProjectMatch): boolean {
    return _match.framework === "express";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const files = await collectJsFiles(expressSearchRoot(match));
    const modules: ParsedModule[] = [];
    const diagnostics: Array<IParseDiagnostic> = [];
    // Parallel reads with a cap, delivered in input order: the
    // collection must come out identical on every run.
    for await (const { path, text } of readFilesInOrder(files)) {
      modules.push(parseModuleSafe(path, text, diagnostics));
    }

    // Map routerName → prefix (includes app.use prefixes).
    const routerPrefixes = new Map<string, string>();
    for (const m of modules) {
      for (const [varName, prefix] of m.routerPrefixes) {
        routerPrefixes.set(varName, prefix);
      }
      for (const [varName, prefix] of m.appUsePrefixes) {
        routerPrefixes.set(varName, prefix);
      }
    }

    // r00014 S4: build a SymbolGraph so cross-file consumers
    // (e.g. future x00055 S2 / `r00014 S5`) can resolve
    // `import { router } from "./routes/users"`-style
    // aliases back to the **declaration** in any file
    // without text-name collisions. Today the per-file
    // router list below stays in this `scan()` for
    // backwards compatibility — the SymbolGraph is
    // emitted as a parallel structure on the result.
    //
    // We register two kinds of nodes:
    // - `kind: "router"` for every `Router()` /
    //   `Router({prefix: …})` declaration the parser
    //   captured (the `routerPrefixes` map)
    // - `kind: "router"` for every `app.use('/x', router)`
    //   mount (the `appUsePrefixes` map, separate SymbolId
    //   keyed by the file holding the `app.use` call)
    const graphBuilder = SymbolGraph.builder();
    for (const m of modules) {
      // Detect `const X = Router()` declarations even when
      // they have no `{prefix}` arg: the AST-detected
      // `routerPrefixes` map only catches the prefix-bearing
      // shape. We catch both via `ast.assignments`.
      for (const varName of m.routerPrefixes.keys()) {
        graphBuilder.addSymbol({
          id: makeSymbolId(m.file, 0, varName),
          kind: "router",
          payload: { prefix: m.routerPrefixes.get(varName) ?? "" },
        });
      }
      for (const varName of m.appUsePrefixes.keys()) {
        graphBuilder.addSymbol({
          id: makeSymbolId(m.file, 0, varName),
          kind: "router",
          payload: { mount: m.appUsePrefixes.get(varName) ?? "" },
        });
      }
    }

    // Walk every route in the modules: for each
    // `router.get(...)` route, register a symbol for the
    // receiver (the router declaration) **per file**. This
    // makes `resolveByName(file, "router")` correct: two
    // same-named routers in two files become two distinct
    // nodes.
    for (const m of modules) {
      const receiverNames = new Set<string>();
      for (const r of m.routes) {
        if (r.routerName) receiverNames.add(r.routerName);
      }
      for (const name of receiverNames) {
        graphBuilder.addSymbol({
          id: makeSymbolId(m.file, 0, name),
          kind: "router",
        });
      }
    }

    const out: ParsedRoute[] = [];
    for (const m of modules) {
      for (const r of m.routes) {
        // If the route comes from a known router, apply its prefix.
        let prefix = "";
        if (r.routerName && routerPrefixes.has(r.routerName)) {
          prefix = routerPrefixes.get(r.routerName) ?? "";
        }
        // Normalise double slashes and trailing slash.
        const fullPath = (prefix + r.path)
          .replace(/\/+/g, "/")
          .replace(/\/+$/, "");
        // `m.file` comes from `collectJsFiles(searchRoot)` so it's
        // absolute from searchRoot (not from match.projectRoot).
        // We use `searchRoot` to derive `sourceFile` so the path
        // matches the scanner's effective workspace.
        const relFile = m.file
          .replace(rawProjectRoot(match), "")
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
    // Files the frontend couldn't parse don't abort the scan, but
    // they don't disappear without a trace either: they go up as
    // diagnostics (a00011 C-7 / B-rev-13).
    //
    // r00014 S3: the Express scanner carries an empty SymbolGraph
    // today. The cross-file router resolution lands in `r00014
    // S4` (and `x00055 S2`); both consume this field.
    return {
      routes: out,
      symbols: graphBuilder.finalize(),
      ...(diagnostics.length > 0
        ? { diagnostics: diagnostics as ReadonlyArray<IParseDiagnostic> }
        : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Validation provider (zod schemas)
// ---------------------------------------------------------------------------

/**
 * Validation provider for Express/Fastify/Koa/Hapi.
 *
 * Detects **inline** validation schemas in the code:
 *   - zod: `z.object({ name: z.string(), email: z.string().email() })`
 *   - Joi: `Joi.object({ name: Joi.string().required() })`
 *
 * Strategy:
 *   1. Read the handler's file.
 *   2. Find the first `z.object({...})` or `Joi.object({...})` that appears
 *      in the handler (lines after the route's line).
 *   3. Convert the fields into `IValidationSpec`s.
 */
export class ExpressZodValidationProvider implements IValidationSpecProvider {
  readonly framework = "express" as const;

  async supports(
    _route: ParsedRoute,
    _match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<boolean> {
    // In principle we always try; resolve returns [] if it finds nothing.
    return true;
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<{ endpointKey: string; fields: IValidationSpec[] }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    const fields = await findInlineSchema(route, match);
    return { endpointKey, fields };
  }
}

/**
 * Parses a `z.object({...})` or `Joi.object({...})` and returns the fields.
 * Best-effort strategy: parens-balanced regexes.
 *
 * Searches the schema across the whole file (not just in the handler),
 * because the most common convention is:
 *
 *   const createUserSchema = z.object({...});
 *   app.post('/users', handler);
 *
 * If there are multiple `z.object()`, we take the first one that
 * appears AFTER the route's line (the closest to the handler).
 *
 * Headers: also detects `headers: z.object({...})` (Joi/zod) in the
 * handler's block, and emits those fields with `location: "header"`.
 */
async function findInlineSchema(
  route: ParsedRoute,
  match: IProjectMatch,
): Promise<IValidationSpec[]> {
  if (!route.sourceFile) return [];
  // Audit 2nd review #4: sourceFile is relative to the effective
  // root (searchRoot if frameworkSearchRoot is set), not to the
  // match's root.
  const abs = join(expressSearchRoot(match), route.sourceFile);
  let raw: string;
  try {
    raw = await readFile(abs, "utf8");
  } catch {
    return [];
  }
  const text = stripJsComments(raw);
  const lines = text.split("\n");

  // 1) Detect which library the handler uses.
  //    Strategy (priority order):
  //    a. **Schema used in the handler**: parse the handler's body
  //       looking for `SchemaName.parse(req.body)` or `SchemaName.validate(req.body)`.
  //       If the schema's name is declared as `= z.object(...)`, use zod.
  //       If as `= Joi.object(...)`, use Joi.
  //    b. **Closest previous non-header**: if the handler uses neither
  //       `.parse()` nor `.validate()`, use the closest previous zod/Joi
  //       schema (skip schemas that look like headers).
  //    c. **Closest of any kind**: if there's nothing body-like, fallback.
  const startLine = Math.max(0, route.lineNumber - 1);
  const handlerBody = collectHandlerBody(lines, startLine);
  const referencedSchemaName = handlerBody
    ? findReferencedSchemaName(handlerBody)
    : null;
  // Resolve which library the referenced schema belongs to.
  let prefer: "zod" | "joi" | null = null;
  if (referencedSchemaName) {
    if (new RegExp(`\\b${referencedSchemaName}\\s*=\\s*z\\s*\\.\\s*object`).test(text)) {
      prefer = "zod";
    } else if (new RegExp(`\\b${referencedSchemaName}\\s*=\\s*Joi\\s*\\.\\s*object`).test(text)) {
      prefer = "joi";
    }
  }

  // 2) zod first, Joi as second option. The schema selection is
  //    identical in both cases, only the library changes.
  for (const library of ["zod", "joi"] as const) {
    // If the handler explicitly references a schema from the OTHER
    // library, we don't guess with this one.
    if (prefer && prefer !== library) continue;

    const call = pickSchemaCall(text, library, startLine, prefer === library ? referencedSchemaName : null);
    if (!call) continue;

    const inner = text.slice(call.callStart + 1, call.callEnd);
    const bodySpecs =
      library === "zod"
        ? parseZodObjectLiteral(inner).map((f) => zodFieldToSpec(f))
        : parseJoiObjectLiteral(inner).map((f) => joiFieldToSpec(f));
    if (bodySpecs.length === 0) continue;

    return [...bodySpecs, ...findHeaderSchemaNear(text, startLine, library)];
  }

  return [];
}

/** Look-back window (chars) where to search for `const X = z.object(`. */
const SCHEMA_DECL_LOOKBEHIND = 80;

/**
 * Picks which `<lib>.object({...})` in the file describes this
 * handler's body, in three steps of decreasing confidence:
 *
 *   1. The schema the handler references by name
 *      (`createUserSchema.parse(req.body)`).
 *   2. The closest previously declared schema that has fields and
 *      doesn't look like a headers schema.
 *   3. The closest one in absolute distance.
 */
function pickSchemaCall(
  text: string,
  library: "zod" | "joi",
  startLine: number,
  referencedSchemaName: string | null,
): IBalancedCall | null {
  const objectRe =
    library === "zod" ? /\bz\s*\.\s*object\s*\(/ : /\bJoi\s*\.\s*object\s*\(/;
  const calls = findAllBalanced(text, objectRe);
  if (calls.length === 0) return null;

  // 1) Referenciado por nombre en el handler.
  if (referencedSchemaName) {
    const declRe = new RegExp(
      `\\b${referencedSchemaName}\\s*=\\s*${library === "zod" ? "z" : "Joi"}\\s*\\.\\s*object`,
    );
    const named = calls.find((c) =>
      declRe.test(text.slice(Math.max(0, c.callStart - SCHEMA_DECL_LOOKBEHIND), c.callStart)),
    );
    if (named) return named;
  }

  // 2) The closest previous one that looks like a body.
  const before = calls
    .map((call) => ({ call, line: countLinesBefore(text, call.callStart) }))
    .filter((x) => x.line < startLine)
    .sort((a, b) => b.line - a.line);
  for (const candidate of before) {
    const inner = text.slice(candidate.call.callStart + 1, candidate.call.callEnd);
    const fields = library === "zod" ? parseZodObjectLiteral(inner) : parseJoiObjectLiteral(inner);
    if (fields.length === 0) continue;
    if (looksLikeHeaderSchema(fields)) continue;
    return candidate.call;
  }

  // 3) The closest one in absolute distance.
  return findNearestBalanced(text, objectRe, startLine);
}

/**
 * Searches for the `headers: <lib>.object({...})` closest to the
 * handler and returns its fields with `location: "header"`.
 *
 * Headers schemas are usually declared in the route's configuration
 * object, right above or below the handler, so line proximity is
 * the best tiebreaker available.
 */
function findHeaderSchemaNear(
  text: string,
  startLine: number,
  library: "zod" | "joi",
): IValidationSpec[] {
  const pattern =
    library === "zod"
      ? /headers\s*:\s*z\s*\.\s*object\s*\(/
      : /headers\s*:\s*Joi\s*\.\s*object\s*\(/;

  const call = findNearestBalanced(text, pattern, startLine);
  if (!call) return [];

  const inner = text.slice(call.callStart + 1, call.callEnd);
  return library === "zod"
    ? parseZodObjectLiteral(inner).map((f) => zodFieldToSpec(f, "header"))
    : parseJoiObjectLiteral(inner).map((f) => joiFieldToSpec(f, "header"));
}

/**
 * Collects the handler's body (the callback `app.METHOD('/x', (req, res) => { ... })`)
 * from `startLine` up to the callback's closing `}`.
 */
function collectHandlerBody(lines: string[], startLine: number): string {
  const out: string[] = [];
  let _parenDepth = 0;
  let braceDepth = 0;
  let started = false;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i] ?? "";
    out.push(line);
    for (const c of line) {
      if (c === "(") _parenDepth++;
      else if (c === ")") _parenDepth--;
      else if (c === "{") {
        braceDepth++;
        if (braceDepth >= 1) started = true;
      } else if (c === "}") {
        braceDepth--;
        if (started && braceDepth === 0) break;
      }
    }
    if (started && braceDepth === 0) break;
  }
  return out.join("\n");
}

/**
 * Searches the schema name referenced in the handler's body:
 *   `const body = CreateUserSchema.parse(req.body);` → "CreateUserSchema"
 *
 * Looks for `.parse(req.body)` or `.validate(req.body)`.
 */
function findReferencedSchemaName(handlerBody: string): string | null {
  const re = /\b([A-Z][\w]*)\s*\.\s*(?:parse|validate)\s*\(\s*req\.body/g;
  for (const m of handlerBody.matchAll(re)) {
    const name = m[1];
    if (!name) continue;
    return name;
  }
  return null;
}

/**
 * Heuristic: does this schema look like a HEADER schema?
 *
 * Recognises:
 * - Any key with a dash (kebab-case HTTP): `X-API-Key`, `Content-Type`, …
 * - Common headers without a dash: `Authorization`, `Accept`, `User-Agent`, …
 *
 * If ALL of the schema's keys are headers, we return true.
 */
const HEADER_KEY_NAMES = new Set([
  "authorization",
  "accept",
  "user-agent",
  "content-type",
  "cookie",
  "host",
  "origin",
  "referer",
  "x-request-id",
  "x-api-key",
  "x-client-key",
  "x-csrf-token",
  "x-forwarded-for",
  "x-real-ip",
  "x-trace-id",
  "x-span-id",
  "x-correlation-id",
  "x-session-token",
  "x-tenant-id",
  "x-version",
]);

function looksLikeHeaderSchema(fields: ReadonlyArray<{ readonly name: string }>): boolean {
  if (fields.length === 0) return false;
  for (const f of fields) {
    const low = f.name.toLowerCase();
    if (low.includes("-")) continue; // kebab-case → header
    if (HEADER_KEY_NAMES.has(low)) continue;
    return false;
  }
  return true;
}

