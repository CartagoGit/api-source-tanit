/**
 * `OpenApiRouteScanner` — implementation of `IProjectScanner` + `IRouteScanner`
 * that reads `openapi.json` / `openapi.yaml` / `openapi.yml` at the
 * project root.
 *
 * It's the highest-ROI scanner: it covers any API documented with
 * OpenAPI 3.x or Swagger 2.0 without needing a per-framework scanner.
 * It also supports files in `public/`, `resources/`, `api/`, `docs/`,
 * `src/` (common paths in Laravel, NestJS, FastAPI…).
 *
 * Limitations:
 * - Static-only reading (no `$ref` resolved from the network).
 * - OpenAPI 3.1 is not supported (it will be partially accepted as 3.0).
 * - Nested `examples` beyond the first level are not parsed.
 *
 * If no OpenAPI file exists, `detect()` returns 0.
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";
import { isRecord, parseJson, readArray, readObject, readString } from "../../core/helpers/parse-json.helper.js";
import { rawProjectRoot } from "../../core/discovery/effective-project-root.helper.js";
import type { OpenApiScannerOptions } from "../../contracts/interfaces/frameworks/scanners.interface.js";

/** Look for OpenAPI in the most common locations. */
const OPENAPI_CANDIDATES = [
  "openapi.json",
  "openapi.yaml",
  "openapi.yml",
  "swagger.json",
  "swagger.yaml",
  "swagger.yml",
  "api-docs.json",
  "public/openapi.json",
  "public/openapi.yaml",
  "public/openapi.yml",
  "resources/openapi.json",
  "resources/openapi.yaml",
  "resources/openapi.yml",
  "api/openapi.json",
  "api/openapi.yaml",
  "api/openapi.yml",
  "docs/openapi.json",
  "docs/openapi.yaml",
  "docs/openapi.yml",
  "src/openapi.json",
  "src/openapi.yaml",
  "src/openapi.yml",
];

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options",
  "trace",
] as const;

// ---------------------------------------------------------------------------
// YAML parser (NO usamos dependencias externas — subset suficiente)
// ---------------------------------------------------------------------------

/**
 * YAML constructs this parser does **not** understand.
 *
 * This is not a wish list: it's what was measured by hammering the
 * parser with weird inputs. The important thing is that none of them
 * crash — they return something **different silently**, which is worse:
 *
 * | Input | What it returns |
 * |---|---|
 * | `a: &x 1` | the string `"&x 1"`, not the number |
 * | `b: *x` | the string `"*x"`, not what `x` was |
 * | `<<: *base` | a literal key named `<<` |
 * | `---` | only the first document, without saying so |
 *
 * Anchors are not exotic in OpenAPI: that's how an error response is
 * shared between twenty endpoints without repeating it. A spec like
 * that parsed «fine» and produced a collection with garbage values.
 *
 * Detecting them and saying so is what separates "I don't support it"
 * from "I lied to you".
 */
const YAML_NO_SOPORTADO: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly what: string;
}> = [
  { pattern: /^\s*[\w"'/.-]+\s*:\s*&\S+/m, what: "anchors (`&name`)" },
  { pattern: /^\s*[\w"'/.-]+\s*:\s*\*\S+/m, what: "aliases (`*name`)" },
  { pattern: /^\s*<<\s*:/m, what: "merge keys (`<<:`)" },
  { pattern: /^---\s*$[\s\S]*^---\s*$/m, what: "multiple documents (`---`)" },
];

/**
 * What's in this YAML that the parser can't read. Empty = everything OK.
 *
 * Exposed so we can warn **before** producing a collection with values
 * that aren't the spec's.
 */
export function unsupportedYamlFeatures(src: string): string[] {
  return YAML_NO_SOPORTADO.filter(({ pattern }) => pattern.test(src)).map(
    ({ what }) => what,
  );
}

/**
 * Minimal YAML parser (no dependencies). Supports what OpenAPI uses:
 * mappings, sequences, scalars (string/number/bool/null), `#` comments,
 * and multi-line scalars `|` and `>`. Everything else falls back to a
 * string literal.
 *
 * **It never throws and never hangs**: on weird input it returns what
 * it can. That makes it robust and at the same time dangerous, because
 * a spec it can't read is indistinguishable from an empty one —
 * hence `unsupportedYamlFeatures`, which does distinguish it.
 *
 * It exists without dependencies on purpose: the compiled binary can't
 * load packages at runtime.
 */
export function parseYamlLite(src: string): unknown {
  // Sanitise: tabs are not valid in YAML.
  const lines = src.replace(/\t/g, "  ").split(/\r?\n/);
  let pos = 0;

  function peekIndent(): number {
    while (pos < lines.length && /^\s*$/.test(lines[pos] ?? "")) pos++;
    const line = lines[pos] ?? "";
    const m = line.match(/^(\s*)/);
    return m ? m[1]!.length : 0;
  }

  function readLine(): string {
    while (pos < lines.length) {
      const l = lines[pos] ?? "";
      if (/^\s*$/.test(l)) { pos++; continue; }
      if (/^\s*#/.test(l)) { pos++; continue; }
      return l;
    }
    return "";
  }

  /**
   * Quita quotes simples o dobles alrededor de una key YAML.
   * `'200'` → `200`, `"200"` → `200`, `200` → `200`.
   * Necesario para OpenAPI responses (`'200': description`) y otros casos.
   */
  function unquoteYamlKey(s: string): string {
    if (
      (s.startsWith("'") && s.endsWith("'")) ||
      (s.startsWith('"') && s.endsWith('"'))
    ) {
      return s.slice(1, -1);
    }
    return s;
  }

  function parseBlock(indent: number): unknown {
    const line = readLine();
    if (line.trim().startsWith("-")) {
      // Sequence
      const arr: unknown[] = [];
      while (pos < lines.length) {
        const cur = lines[pos] ?? "";
        if (/^\s*$/.test(cur)) { pos++; continue; }
        const ci = cur.match(/^(\s*)/)?.[1]?.length ?? 0;
        if (ci < indent) break;
        if (ci === indent && cur.trim().startsWith("-")) {
          const rest = cur.replace(/^\s*-\s*/, "");
          if (rest === "") {
            pos++;
            arr.push(parseBlock(indent + 2));
          } else if (rest.includes(":")) {
            // Inline map starting after "- "
            const inlineMap: Record<string, unknown> = {};
            const [k, ...vParts] = rest.split(":");
            const v = vParts.join(":").trim();
            if (k) {
              if (v === "" || v === "|" || v === ">") {
                inlineMap[k] = "";
                pos++;
                if (v === "|" || v === ">") {
                  const blockLines: string[] = [];
                  while (pos < lines.length) {
                    const nl = lines[pos] ?? "";
                    const ni = nl.match(/^(\s*)/)?.[1]?.length ?? 0;
                    if (ni < indent + 2) break;
                    blockLines.push(nl.slice(indent + 2));
                    pos++;
                  }
                  inlineMap[k] = blockLines.join("\n");
                } else {
                  inlineMap[k] = parseBlock(indent + 2);
                }
              } else {
                inlineMap[k] = parseScalar(v);
              }
            }
            pos++;
            // Continue the map on the following lines
            while (pos < lines.length) {
              const next = lines[pos] ?? "";
              if (/^\s*$/.test(next)) { pos++; continue; }
              const ni = next.match(/^(\s*)/)?.[1]?.length ?? 0;
              if (ni <= indent) break;
              if (ni > indent + 2) break;
              if (ni === indent + 2) {
                const [nk, ...nvParts] = next.trim().split(":");
                const nv = nvParts.join(":").trim();
                if (nk) {
                  if (nv === "" || nv === "|" || nv === ">") {
                    pos++;
                    if (nv === "|" || nv === ">") {
                      const blockLines: string[] = [];
                      while (pos < lines.length) {
                        const nl = lines[pos] ?? "";
                        const nii = nl.match(/^(\s*)/)?.[1]?.length ?? 0;
                        if (nii < indent + 2) break;
                        blockLines.push(nl.slice(indent + 2));
                        pos++;
                      }
                      inlineMap[nk] = blockLines.join("\n");
                    } else {
                      inlineMap[nk] = parseBlock(indent + 2);
                    }
                  } else {
                    inlineMap[nk] = parseScalar(nv);
                    pos++;
                  }
                }
              } else {
                break;
              }
            }
            arr.push(inlineMap);
          } else {
            arr.push(parseScalar(rest));
            pos++;
          }
        } else {
          break;
        }
      }
      return arr;
    }
    // Mapping
    const obj: Record<string, unknown> = {};
    while (pos < lines.length) {
      const cur = lines[pos] ?? "";
      if (/^\s*$/.test(cur)) { pos++; continue; }
      // Skip `#` comments inside mappings too.
      if (/^\s*#/.test(cur)) { pos++; continue; }
      const ci = cur.match(/^(\s*)/)?.[1]?.length ?? 0;
      if (ci < indent) break;
      const mm = cur.trim().match(/^([^:]+):\s*(.*)$/);
      if (!mm) break;
      const key = unquoteYamlKey((mm[1] ?? "").trim());
      const valueRaw = (mm[2] ?? "").trim();
      if (key.startsWith("#")) { pos++; continue; }
      if (valueRaw === "" || valueRaw === "|" || valueRaw === ">") {
        pos++;
        if (valueRaw === "|" || valueRaw === ">") {
          const blockLines: string[] = [];
          while (pos < lines.length) {
            const nl = lines[pos] ?? "";
            const ni = nl.match(/^(\s*)/)?.[1]?.length ?? 0;
            if (ni < indent + 2) break;
            blockLines.push(nl.slice(indent + 2));
            pos++;
          }
          obj[key] = blockLines.join("\n");
        } else {
          obj[key] = parseBlock(indent + 2);
        }
      } else {
        obj[key] = parseScalar(valueRaw);
        pos++;
      }
    }
    return obj;
  }

  function parseScalar(s: string): unknown {
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "null" || s === "~") return null;
    if (/^-?\d+$/.test(s)) return Number(s);
    if (/^-?\d+\.\d+$/.test(s)) return Number(s);
    // Quoted strings
    const sq = s.match(/^'(.*)'$/);
    if (sq) return sq[1] ?? "";
    const dq = s.match(/^"(.*)"$/);
    if (dq) return dq[1] ?? "";
    // Inline array (flow sequence): [a, b, c]
    if (s.startsWith("[") && s.endsWith("]")) {
      const inner = s.slice(1, -1).trim();
      if (inner === "") return [];
      const items = splitTopLevelCsv(inner);
      return items.map((it) => parseScalar(it.trim()));
    }
    // Inline map (flow mapping): { type: string, format: email }.
      // Very common in hand-written OpenAPI specs for properties and
      // parameters. Without this, the whole schema stayed as a literal
      // and fields came out with `type: "any"`.
    if (s.startsWith("{") && s.endsWith("}")) {
      const inner = s.slice(1, -1).trim();
      const obj: Record<string, unknown> = {};
      if (inner === "") return obj;
      for (const entry of splitTopLevelCsv(inner)) {
        const sep = findFlowKeySeparator(entry);
        if (sep === -1) continue;
        const key = unquoteYamlKey(entry.slice(0, sep).trim());
        if (!key) continue;
        obj[key] = parseScalar(entry.slice(sep + 1).trim());
      }
      return obj;
    }
    // Anchors / aliases are not supported; return literal.
    return s;
  }

  /**
   * Index of the `:` separating key and value in a flow-mapping entry.
   * Ignores `:` inside quotes or nested `[]`/`{}`, so it doesn't split
   * on the `:` of `{ default: { a: 1 } }` or on a URL's colon.
   */
  function findFlowKeySeparator(entry: string): number {
    let depth = 0;
    let inString: string | null = null;
    for (let i = 0; i < entry.length; i++) {
      const c = entry[i];
      if (inString) {
        if (c === inString) inString = null;
        continue;
      }
      if (c === "'" || c === '"') {
        inString = c;
        continue;
      }
      if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") depth--;
      else if (c === ":" && depth === 0) return i;
    }
    return -1;
  }

  /**
   * Split por `,` al nivel top (no rompe quotes ni `[]`/`{}`).
   */
  function splitTopLevelCsv(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    let inStr: false | "'" | '"' = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        cur += c;
        if (c === inStr) inStr = false;
        continue;
      }
      if (c === "'" || c === '"') {
        inStr = c;
        cur += c;
        continue;
      }
      if (c === "[" || c === "{" || c === "(") {
        depth++;
        cur += c;
        continue;
      }
      if (c === "]" || c === "}" || c === ")") {
        depth--;
        cur += c;
        continue;
      }
      if (c === "," && depth === 0) {
        out.push(cur);
        cur = "";
        continue;
      }
      cur += c;
    }
    if (cur.length > 0) out.push(cur);
    return out;
  }

  peekIndent();
  return parseBlock(0);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export class OpenApiProjectScanner implements IProjectScanner {
  readonly framework = "openapi" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    for (const rel of OPENAPI_CANDIDATES) {
      if (existsSync(join(projectRoot, rel))) {
        return withEvidence(1, [{
          signal: `Spec OpenAPI/Swagger presente (${rel})`,
          weight: 1,
          artifact: rel,
        }]);
      }
    }
    return emptyResult(0);
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const artifacts: string[] = [];
    for (const rel of OPENAPI_CANDIDATES) {
      const abs = join(projectRoot, rel);
      if (existsSync(abs)) artifacts.push(rel);
    }
    return {
      framework: "openapi",
      projectRoot,
      artifacts,
    };
  }
}

// ---------------------------------------------------------------------------
// Route scanner
// ---------------------------------------------------------------------------

export class OpenApiRouteScanner implements IRouteScanner {
  readonly framework = "openapi" as const;

  constructor(private readonly opts: OpenApiScannerOptions = {}) {}

  matches(_match: IProjectMatch): boolean {
    return _match.framework === "openapi";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const specRel = this.opts.specPath ?? match.artifacts[0];
    if (!specRel) return { routes: [] };
    const absPath = resolve(rawProjectRoot(match), specRel);
    let raw: string;
    try {
      raw = await readFile(absPath, "utf8");
    } catch {
      return { routes: [] };
    }
    let spec: unknown;
    if (specRel.endsWith(".json")) {
      const parsed = parseJson(raw);
      if (!parsed.ok) {
        throw new Error(`OpenApiRouteScanner: cannot parse ${specRel}: ${parsed.reason}`);
      }
      spec = parsed.value;
    } else {
      // Warn **before** parsing: the parser doesn't throw on these
      // constructs, it returns values that aren't the spec's. A
      // failure you don't see is the one that ends up in the collection.
      const noSoportado = unsupportedYamlFeatures(raw);
      if (noSoportado.length > 0) {
        console.warn(
          `⚠ ${specRel} uses YAML this parser doesn't understand: ${noSoportado.join(", ")}.\n` +
            "  · The affected values will come out wrong in the collection, with no further warning.\n" +
            "  · Convert it to JSON (`openapi.json`) and it will be read in full.",
        );
      }
      try {
        spec = parseYamlLite(raw);
      } catch (e) {
        // YAML syntax error: abort cleanly.
        throw new Error(`OpenApiRouteScanner: cannot parse ${specRel}: ${(e as Error).message}`);
      }
    }
    const basePath =
      this.opts.basePath ??
      readString(spec, "basePath") ??
      serverPath(readArray(spec, "servers"));
    const paths = readObject(spec, "paths") ?? {};
    const out: ParsedRoute[] = [];
    for (const [pathTemplate, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== "object") continue;
      const item = pathItem as Record<string, unknown>;
      // Path-level `parameters` were read here only to store them in
      // `__params`, and nobody consumed them: `resolve()` re-reads the
      // spec from disk. When the hidden property was removed, they
      // were left without a reader, so they go with it.
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (!op || typeof op !== "object") continue;
        const opObj = op as Record<string, unknown>;
        const tags = Array.isArray(opObj.tags) ? (opObj.tags as string[]) : [];
        const summary = typeof opObj.summary === "string" ? opObj.summary : "";
        const description = typeof opObj.description === "string" ? opObj.description : "";
        const operationId = typeof opObj.operationId === "string" ? opObj.operationId : "";
        const uri = join(basePath, pathTemplate).replace(/\/+/g, "/");
        out.push({
          method: method.toUpperCase(),
          uri,
          rawUri: pathTemplate,
          sourceFile: `${specRel}#${method.toUpperCase()}${pathTemplate}`,
          lineNumber: 0,
          prefixChain: basePath ? [basePath] : [],
          displayName: operationId || summary || `${method.toUpperCase()} ${pathTemplate}`,
          ...(tags.length > 0 ? { tags } : {}),
          ...(description ? { description } : {}),
          ...(summary && !description ? { description: summary } : {}),
        });
      }
    }
    return { routes: out };
  }
}

function serverPath(servers: unknown[] | undefined): string {
  const first = servers?.[0];
  const url = isRecord(first) ? readString(first, "url") : undefined;
  if (!url) return "";
  try {
    return new URL(url, "http://openapi.local").pathname.replace(/\/$/, "");
  } catch {
    return url.split(/[?#]/, 1)[0]?.replace(/^https?:\/\/[^/]+/i, "").replace(/\/$/, "") ?? "";
  }
}

// ---------------------------------------------------------------------------
// Validation spec provider (extrae schemas OpenAPI)
// ---------------------------------------------------------------------------

interface OpenApiSchema {
  type?: string;
  format?: string;
  enum?: unknown[];
  maxLength?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  description?: string;
  example?: unknown;
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
}

function schemaToField(
  name: string,
  location: IValidationSpec["location"],
  required: boolean,
  schema: OpenApiSchema,
): IValidationSpec {
  const type = ((): IValidationSpec["type"] => {
    if (schema.enum && Array.isArray(schema.enum)) return "enum";
    switch (schema.type) {
      case "integer":
        return "integer";
      case "number":
        return "number";
      case "boolean":
        return "boolean";
      case "array":
        return "array";
      case "object":
        return "object";
      case "string":
        if (schema.format === "date") return "date";
        if (schema.format === "date-time") return "datetime";
        return "string";
      case "file":
        return "file";
      default:
        return "any";
    }
  })();
  const field: IValidationSpec = {
    fieldName: name,
    location,
    type,
    required,
    ...(schema.format ? { format: schema.format } : {}),
    ...(Array.isArray(schema.enum)
      ? { enumValues: schema.enum.map((e) => String(e)) }
      : {}),
    ...(typeof schema.maxLength === "number" ? { maxLength: schema.maxLength } : {}),
    ...(typeof schema.minLength === "number" ? { minLength: schema.minLength } : {}),
    ...(typeof schema.minimum === "number" ? { minimum: schema.minimum } : {}),
    ...(typeof schema.maximum === "number" ? { maximum: schema.maximum } : {}),
    ...(typeof schema.pattern === "string" ? { pattern: schema.pattern } : {}),
    ...(typeof schema.description === "string" ? { description: schema.description } : {}),
    ...(schema.example !== undefined ? { example: schema.example } : {}),
  };
  return field;
}

export class OpenApiValidationProvider implements IValidationSpecProvider {
  readonly framework = "openapi" as const;

  /**
   * A route is its own if it comes from this scanner.
   *
   * Before, it asked about a hidden property (`__params`) that the
   * scanner itself stuffed with `as any` into the contract object,
   * because a route had no way of saying where it came from. It was
   * needed in hybrid projects — Express with an OpenAPI spec on the
   * side — where `match.framework` is the dominant framework's and not
   * each route's. With `route.framework` the question answers itself,
   * and the contract again describes everything flowing through the
   * pipeline.
   */
  async supports(
    route: ParsedRoute,
    match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<boolean> {
    return route.framework === "openapi" || match.framework === "openapi";
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<Awaited<ReturnType<IValidationSpecProvider["resolve"]>>> {
    const specRel = this.getSpecPath(match);
    if (!specRel) return { endpointKey: keyOf(route), fields: [] };
    const absPath = resolve(rawProjectRoot(match), specRel);
    let raw: string;
    try {
      raw = await readFile(absPath, "utf8");
    } catch {
      return { endpointKey: keyOf(route), fields: [] };
    }
    let spec: unknown;
    if (specRel.endsWith(".json")) {
      const parsed = parseJson(raw);
      if (!parsed.ok) {
        return { endpointKey: keyOf(route), fields: [] };
      }
      spec = parsed.value;
    } else {
      try {
        spec = parseYamlLite(raw);
      } catch {
        return { endpointKey: keyOf(route), fields: [] };
      }
    }
    const pathItem = readObject(readObject(spec, "paths"), route.rawUri);
    if (!pathItem) return { endpointKey: keyOf(route), fields: [] };
    const op = readObject(pathItem, route.method.toLowerCase());
    if (!op) return { endpointKey: keyOf(route), fields: [] };
    const fields: IValidationSpec[] = [];
    const params = [
      ...(readArray(pathItem, "parameters") ?? []),
      ...(readArray(op, "parameters") ?? []),
    ];
    for (const p of params) {
      if (!isRecord(p)) continue;
      // Resolve $ref in parameters (e.g. `{$ref: '#/components/parameters/X'}`).
      const resolvedRaw = resolveRef(p, spec);
      const resolvedP = isRecord(resolvedRaw) ? resolvedRaw : p;
      // name, in, required can be in the resolved $ref or in the original.
      const name = readString(resolvedP, "name") ?? readString(p, "name") ?? "";
      const inLoc = (readString(resolvedP, "in") ??
        readString(p, "in") ??
        "query") as IValidationSpec["location"];
      const required = Boolean(resolvedP["required"] ?? p["required"]);
      const schema = (readObject(resolvedP, "schema") ?? {}) as OpenApiSchema;
      fields.push(schemaToField(name, inLoc, required, schema));
    }
    // Request body (JSON)
    const content = readObject(op, "requestBody");
    const json = readObject(readObject(content, "content"), "application/json");
    if (json) {
      const raw = readObject(json, "schema") ?? {};
      // Resolve top-level $ref (e.g. `{$ref: '#/components/schemas/X'}`).
      const resolved = resolveRef(raw, spec);
      const schema = (resolved ?? raw) as OpenApiSchema;
      // allOf: merge properties + required from each subschema.
      const merged = mergeAllOf(schema, spec);
      const required = new Set(merged.required ?? []);
      for (const [name, sub] of Object.entries(merged.properties ?? {})) {
        fields.push(schemaToField(name, "body", required.has(name), sub as OpenApiSchema));
      }
    }
    return { endpointKey: keyOf(route), fields };
  }

  private getSpecPath(match: IProjectMatch): string | undefined {
    return match.artifacts[0];
  }
}

function keyOf(route: ParsedRoute): string {
  return `${route.method} ${route.uri}`.toLowerCase();
}

/**
 * Resolves a local `$ref` (`#/components/schemas/X`) in the spec.
 * Supports one level of indirection. Returns `null` if it can't resolve.
 */
function resolveRef(obj: unknown, spec: unknown): unknown {
  if (!isRecord(obj)) return null;
  const ref = obj["$ref"];
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  let current: unknown = spec;
  for (const part of ref.slice(2).split("/")) {
    if (!isRecord(current) || !(part in current)) return null;
    current = current[part];
  }
  return current;
}

/**
 * Combines an OpenAPI schema with deeper `allOf: [...]`.
 *
 * Supports:
 * - `allOf: [{schemaBody}, {schemaBody2}]` → merges properties and required.
 * - `$ref` in `allOf` items: resolved if `spec` is passed.
 * - `oneOf`/`anyOf`: NOT merged (better to omit than to guess).
 */
function mergeAllOf(
  schema: unknown,
  spec?: unknown,
  /**
   * The `$ref`s already visited on this branch.
   *
   * The recursion is **unbounded by construction**: an `allOf` with
   * a `$ref` leads to `resolveRef`, and what it returns enters here
   * again. `A → allOf: [$ref B]` with `B → allOf: [$ref A]` would call
   * itself forever, and this reads other people's specs. A hang
   * hasn't been reproduced — the path here requires the spec to parse
   * and the route to carry a body — but unbounded recursion on
   * external input doesn't need a reproduction to deserve a bound.
   *
   * The branch is cut, not everything: a `$ref` repeated on two
   * different branches is legitimate and common — a shared error
   * response — and marking it globally would cause the second to be
   * lost.
   */
  visitados: ReadonlySet<string> = new Set(),
): { properties: Record<string, OpenApiSchema>; required: string[] } {
  const properties: Record<string, OpenApiSchema> = {};
  const required: string[] = [];
  if (!isRecord(schema)) return { properties, required };

  // Resolve $ref in the root schema.
  const ref = schema["$ref"];
  if (typeof ref === "string" && spec) {
    if (visitados.has(ref)) return { properties, required };
    const resolved = resolveRef(schema, spec);
    if (resolved) return mergeAllOf(resolved, spec, new Set([...visitados, ref]));
  }

  // Properties of the root schema.
  const props = schema["properties"];
  if (isRecord(props)) {
    for (const [k, v] of Object.entries(props)) {
      properties[k] = v as OpenApiSchema;
    }
  }
  const req = schema["required"];
  if (Array.isArray(req)) {
    for (const r of req) {
      if (typeof r === "string" && !required.includes(r)) required.push(r);
    }
  }

  // allOf: merge each subschema.
  const allOf = schema["allOf"];
  if (Array.isArray(allOf)) {
    for (const sub of allOf) {
      const merged = mergeAllOf(sub, spec, visitados);
      for (const [k, v] of Object.entries(merged.properties)) {
        properties[k] = v;
      }
      for (const r of merged.required) {
        if (!required.includes(r)) required.push(r);
      }
    }
  }
  return { properties, required };
}
