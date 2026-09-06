/**
 * `FastifyScanner` — `IProjectScanner` + `IRouteScanner` +
 * `IValidationSpecProvider` for Fastify.
 *
 * Detection:
 *   - `fastify` in the `package.json` dependencies.
 *
 * Route parsing, the three shapes Fastify uses:
 *   - `app.get("/users", handler)` — the short form, like Express.
 *   - `app.route({ method: "GET", url: "/users", … })` — the long form.
 *   - Plugin prefixes: `app.register(routes, { prefix: "/api/v1" })`.
 *
 * Validation:
 *   Fastify is the only big Node framework that carries the schema
 *   **inside the route declaration**:
 *
 *     app.post("/users", {
 *       schema: {
 *         body: { type: "object", required: ["email"], properties: {…} },
 *         querystring: {…},
 *         headers: {…},
 *       },
 *     }, handler);
 *
 *   That is JSON Schema, which is **exact** type information instead of
 *   inferred. It's the best source a scanner can have, which is why
 *   this framework reads better than those relying on an external
 *   validation library.
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { collectFiles, isSourceJsTsFile } from "../../core/helpers/fs-walk.helper.js";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import { findAllBalanced, findOutsideStrings, findClosingParen, stripJsComments } from "../../core/helpers/source-scan.helper.js";
import { isRecord, parseJson } from "../../core/helpers/parse-json.helper.js";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import { effectiveProjectRoot, rawProjectRoot } from "../../core/discovery/effective-project-root.helper.js";
import { SymbolGraph } from "../../core/discovery/symbol-graph.js";
import { relative } from "node:path";
import type {
  IEndpointValidation,
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"] as const;

/** `app.get("/x"` and friends. */
const SHORT_ROUTE_RE = new RegExp(
  String.raw`\b[\w$]+\s*\.\s*(${HTTP_METHODS.join("|")})\s*\(\s*(['"\`])([^'"\`]+)\2`,
  "gi",
);

/** `app.route({ method: "GET", url: "/x" })`, en cualquier orden. */
const ROUTE_OBJECT_RE = /\.route\s*\(\s*\{/g;
const METHOD_FIELD_RE = /method\s*:\s*(['"`])(\w+)\1/i;
const METHOD_ARRAY_RE = /method\s*:\s*\[([^\]]+)\]/i;
const URL_FIELD_RE = /url\s*:\s*(['"`])([^'"`]+)\1/i;

/** `app.register(x, { prefix: "/api" })`. */
const REGISTER_PREFIX_RE = /\.register\s*\([^)]*?prefix\s*:\s*(['"`])([^'"`]+)\1/g;

/**
 * Reads the project's `package.json` and returns the parsed object, or
 * `null` if it doesn't exist or doesn't parse. Going through `parseJson`
 * distinguishes "couldn't read" from "parsed to `null`": the second is
 * legitimate (a valid `package.json` containing `null`); the first is
 * the `SyntaxError` case the previous pattern silently swallowed.
 */
async function readPackageJson(projectRoot: string): Promise<Record<string, unknown> | null> {
  const path = join(projectRoot, "package.json");
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  const parsed = parseJson(raw);
  if (!parsed.ok) return null;
  return isRecord(parsed.value) ? parsed.value : null;
}

function dependsOnFastify(pkg: Record<string, unknown> | null): boolean {
  if (!pkg) return false;
  const deps = {
    ...((pkg["dependencies"] as Record<string, string>) ?? {}),
    ...((pkg["devDependencies"] as Record<string, string>) ?? {}),
  };
  return Object.keys(deps).some((name) => name === "fastify" || name.startsWith("@fastify/"));
}

/**
 * Lockfiles present in `projectRoot` as bonus runtime signals.
 *
 * f00011 S4: `pnpm-lock.yaml` and Bun lockfiles refine the detector's
 * confidence without being detection. Small weights: +0.1 (pnpm),
 * +0.15 (bun). The Fastify detector is almost always at the top (1.0
 * with `fastify` direct) — the signal stays in `evidence` even though
 * it doesn't change the visible score. The idea is exactly that: the
 * lockfile is **runtime traceability**, not detection.
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

export class FastifyProjectScanner implements IProjectScanner {
  readonly framework = "fastify" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const pkg = await readPackageJson(projectRoot);
    if (!dependsOnFastify(pkg)) return emptyResult(0);
    // The bare `fastify` package is a strong signal; just a plugin
    // `@fastify/*` could be from a project that uses it incidentally.
    const deps = {
      ...((pkg?.["dependencies"] as Record<string, string>) ?? {}),
      ...((pkg?.["devDependencies"] as Record<string, string>) ?? {}),
    };
    const hasFastifyDirect = "fastify" in deps;
    const evidence = hasFastifyDirect
      ? [{ signal: "package.json declares fastify directly", weight: 1, artifact: "package.json" }]
      : [{ signal: "package.json only declares @fastify/* plugins (incidental use)", weight: 0.6, artifact: "package.json" }];
    // f00011 S4: lockfile as runtime bonus. Added at the end so it
    // can't mask an absent framework.
    const locks = lockfileSignals(projectRoot);
    evidence.push(...locks);
    const baseScore = hasFastifyDirect ? 1 : 0.6;
    const lockBonus = locks.reduce((a, e) => a + e.weight, 0);
    return withEvidence(baseScore + lockBonus, evidence);
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const pkg = await readPackageJson(projectRoot);
    const deps = (pkg?.["dependencies"] as Record<string, string>) ?? {};
    return {
      framework: "fastify",
      projectRoot,
      artifacts: ["package.json"],
      ...(deps["fastify"] ? { version: deps["fastify"] } : {}),
    };
  }
}

export class FastifyRouteScanner implements IRouteScanner {
  readonly framework = "fastify" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "fastify";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    // a00012 S1.b / a00014 S2: the effective root respects
    // `frameworkSearchRoot` for monorepos. Before it was
    // `match.projectRoot` directly, which in a monorepo made
    // `collectFiles` walk the whole workspace tree instead of the
    // framework's subdirectory.
    const files = await collectFiles(effectiveProjectRoot(match), isSourceJsTsFile);
    const routes: ParsedRoute[] = [];
    // `schemas` lives here, not as an instance field: if it survived
    // across calls, two consecutive scans would share the JSON Schemas
    // and a "no-schema" route could inherit the previous one.
    // This is the bug a00010 S2 closed.
    const schemas = new Map<string, string>();

    // Parallel reads with a cap, delivered in input order: the
    // collection must come out identical every time.
    for await (const { path: file, text: raw } of readFilesInOrder(files)) {
      if (!/\bfastify\b|\.route\s*\(|\.(get|post|put|patch|delete)\s*\(/i.test(raw)) continue;

      const source = stripJsComments(raw);
      const sourceFile = relative(rawProjectRoot(match), file);
      const prefix = prefixOf(source);

      for (const { route, callStart, callEnd } of parseShortRoutes(
        source,
        prefix,
        sourceFile,
      )) {
        routes.push(route);
        const schema = schemaInCall(source, callStart, callEnd);
        if (schema) schemas.set(`${route.method} ${route.uri}`, schema);
      }
      for (const { route, callStart, callEnd } of parseRouteObjects(
        source,
        prefix,
        sourceFile,
      )) {
        routes.push(route);
        const schema = schemaInCall(source, callStart, callEnd);
        if (schema) schemas.set(`${route.method} ${route.uri}`, schema);
      }
    }

    const unique = dedupe(routes);
    return {
      routes: unique,
      // r00014 S3: every JS/TS scanner carries an empty
      // SymbolGraph today. The cross-file plugin / sub-app
      // resolution lands in `r00014 S4`+; both consume
      // this field. Empty is a valid value — it tells
      // callers "this framework does not yet emit a graph".
      symbols: SymbolGraph.empty(),
      // Only emits `schemas` when at least one exists: avoids an empty
      // `Map` in the `IScanResult` that the provider would have to
      // treat as "not found".
      ...(schemas.size > 0 ? { schemas } : {}),
    };
  }
}

/**
 * Prefix of the file, if it registers its routes under one.
 *
 * Fastify declares it on the plugin's `register`, which is usually in
 * ANOTHER file (the one that mounts the app). Here we pick the one in
 * the same file, covering the case of a self-contained plugin; the
 * cross-file mount requires following imports and is left for the AST
 * engine (p00030).
 */
function prefixOf(source: string): string {
  const prefixes = [...source.matchAll(REGISTER_PREFIX_RE)].map((m) => m[2] ?? "");
  return prefixes.length === 1 ? (prefixes[0] ?? "") : "";
}

/** A short route with the bounds of its call, to scope the schema. */
interface IShortRoute {
  readonly route: ParsedRoute;
  readonly callStart: number;
  readonly callEnd: number;
}

function parseShortRoutes(
  source: string,
  prefix: string,
  sourceFile: string,
): IShortRoute[] {
  const out: IShortRoute[] = [];
  // See the Hono comment: a call inside a string is not a route.
  for (const { match, index } of findOutsideStrings(source, SHORT_ROUTE_RE)) {
    const method = (match[1] ?? "").toUpperCase();
    const rawUri = match[3] ?? "";
    if (!rawUri.startsWith("/")) continue;

    const parenAt = source.indexOf("(", index);
    const callEnd = findClosingParen(source, parenAt);
    out.push({
      route: {
        lineNumber: lineOf(source, match.index ?? 0),
        method,
        uri: joinRoutePath(prefix, rawUri),
        rawUri,
        sourceFile,
        prefixChain: prefix ? [prefix] : [],
      },
      callStart: parenAt,
      callEnd: callEnd === -1 ? parenAt : callEnd,
    });
  }
  return out;
}

function parseRouteObjects(
  source: string,
  prefix: string,
  sourceFile: string,
): IShortRoute[] {
  const routes: IShortRoute[] = [];

  for (const call of findAllBalanced(source, ROUTE_OBJECT_RE)) {
    const body = source.slice(call.callStart, call.callEnd);
    const rawUri = URL_FIELD_RE.exec(body)?.[2];
    if (!rawUri) continue;

    // `method` accepts a string or an array: `method: ["GET", "HEAD"]`.
    const single = METHOD_FIELD_RE.exec(body)?.[2];
    const many = METHOD_ARRAY_RE.exec(body)?.[1];
    const methods = many
      ? many
          .split(",")
          .map((part) => part.replace(/['"`\s]/g, ""))
          .filter(Boolean)
      : single
        ? [single]
        : [];

    for (const method of methods) {
      routes.push({
        route: {
          lineNumber: lineOf(source, call.callStart),
          method: method.toUpperCase(),
          uri: joinRoutePath(prefix, rawUri),
          rawUri,
          sourceFile,
          prefixChain: prefix ? [prefix] : [],
        },
        callStart: call.callStart,
        callEnd: call.callEnd,
      });
    }
  }
  return routes;
}

/**
 * The `schema: {…}` of a short route, if it declares one.
 *
 * It's searched **within the call's own parentheses**, not within a
 * character window. With a window, an `app.get("/health", h)` without
 * a schema would take the one from the `app.post("/users", { schema })`
 * below, and the endpoint would come out with rules that weren't its
 * own.
 */
function schemaInCall(source: string, callStart: number, callEnd: number): string | null {
  const call = source.slice(callStart, callEnd);
  const schemaAt = call.search(/\bschema\s*:\s*\{/);
  if (schemaAt === -1) return null;

  const braceStart = call.indexOf("{", schemaAt);
  let depth = 0;
  for (let i = braceStart; i < call.length; i++) {
    if (call[i] === "{") depth++;
    else if (call[i] === "}") {
      depth--;
      if (depth === 0) return call.slice(braceStart, i + 1);
    }
  }
  return null;
}

/** Line number (1-based) of a file offset. */
function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
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

/**
 * Validation rules from the route's own JSON Schema.
 *
 * Unlike zod or Joi, there's no library DSL to interpret here: Fastify
 * uses JSON Schema, which already declares the type, which fields are
 * mandatory, and the bounds. It's exact information, not inferred.
 *
 * It does not retain the scanner: the JSON Schema lives in
 * `scanResult.schemas`, which is built on each `scan()` and discarded
 * when it ends. Before it had `private readonly scanner: FastifyRouteScanner`
 * and read from an instance `Map`, and two scans contaminated each
 * other (a00010 S2).
 */
export class FastifySchemaProvider implements IValidationSpecProvider {
  readonly framework = "fastify" as const;

  async supports(
    route: ParsedRoute,
    _match: IProjectMatch,
    scanResult: IScanResult,
  ): Promise<boolean> {
    return scanResult.schemas?.has(`${route.method} ${route.uri}`) ?? false;
  }

  async resolve(
    route: ParsedRoute,
    _match: IProjectMatch,
    scanResult: IScanResult,
  ): Promise<IEndpointValidation> {
    const endpointKey = `${route.method} ${route.uri}`;
    const json = scanResult.schemas?.get(`${route.method} ${route.uri}`);
    return { endpointKey, fields: json ? parseFastifySchema(json) : [] };
  }
}

/** Sections of Fastify's `schema` → where the field goes. */
const SECTION_TO_LOCATION: Record<string, IValidationSpec["location"]> = {
  body: "body",
  querystring: "query",
  query: "query",
  params: "path",
  headers: "header",
};

/** JSON Schema types → those of the contract. */
const JSON_TYPE_MAP: Record<string, IValidationSpec["type"]> = {
  string: "string",
  integer: "integer",
  number: "number",
  boolean: "boolean",
  array: "array",
  object: "object",
};

export function parseFastifySchema(schemaJson: string): IValidationSpec[] {
  const fields: IValidationSpec[] = [];

  for (const [section, location] of Object.entries(SECTION_TO_LOCATION)) {
    const sectionBody = extractBlock(schemaJson, section);
    if (!sectionBody) continue;

    const required = new Set(
      (/required\s*:\s*\[([^\]]*)\]/.exec(sectionBody)?.[1] ?? "")
        .split(",")
        .map((name) => name.replace(/['"`\s]/g, ""))
        .filter(Boolean),
    );

    const properties = extractBlock(sectionBody, "properties");
    if (!properties) continue;

    for (const [name, definition] of topLevelEntries(properties)) {
      const rawType = /type\s*:\s*(['"`])(\w+)\1/.exec(definition)?.[2] ?? "string";
      const format = /format\s*:\s*(['"`])([\w-]+)\1/.exec(definition)?.[2];
      const enumValues = /enum\s*:\s*\[([^\]]*)\]/.exec(definition)?.[1];

      fields.push({
        fieldName: name,
        location,
        type: JSON_TYPE_MAP[rawType] ?? "string",
        required: required.has(name),
        ...(format ? { format } : {}),
        ...(enumValues
          ? {
              enumValues: enumValues
                .split(",")
                .map((value) => value.replace(/['"`\s]/g, ""))
                .filter(Boolean),
            }
          : {}),
      });
    }
  }

  return fields;
}

/** The `{…}` that follows `<name>:`, with balanced braces. */
function extractBlock(source: string, name: string): string | null {
  const at = source.search(new RegExp(String.raw`\b${name}\s*:\s*\{`));
  if (at === -1) return null;
  const start = source.indexOf("{", at);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start + 1, i);
    }
  }
  return null;
}

/** `key: {…}` pairs at the first level of a properties block. */
function topLevelEntries(block: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const keyRe = /(?:^|[,{\s])(['"`]?)([\w$-]+)\1\s*:\s*\{/g;

  let match: RegExpExecArray | null;
  while ((match = keyRe.exec(block)) !== null) {
    const start = block.indexOf("{", match.index + match[0].length - 1);
    let depth = 0;
    for (let i = start; i < block.length; i++) {
      if (block[i] === "{") depth++;
      else if (block[i] === "}") {
        depth--;
        if (depth === 0) {
          entries.push([match[2] ?? "", block.slice(start + 1, i)]);
          keyRe.lastIndex = i;
          break;
        }
      }
    }
  }
  return entries;
}
