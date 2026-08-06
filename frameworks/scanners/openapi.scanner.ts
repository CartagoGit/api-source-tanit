/**
 * `OpenApiScanner` — implementación de `IProjectScanner` + `IRouteScanner`
 * que lee `openapi.json` / `openapi.yaml` / `openapi.yml` en la raíz
 * del proyecto.
 *
 * Es el scanner con MAYOR ROI: cubre cualquier API documentada con
 * OpenAPI 3.x o Swagger 2.0 sin necesidad de scanner específico por
 * framework. Soporta además archivos en `public/`, `resources/`, `api/`,
 * `docs/`, `src/` (rutas comunes en Laravel, NestJS, FastAPI…).
 *
 * Limitaciones:
 * - Solo lectura estática (no `$ref` resueltos desde red).
 * - No soporta OpenAPI 3.1 (lo aceptará parcialmente como 3.0).
 * - No parsea `examples` anidados más allá del primer nivel.
 *
 * Si no hay ningún fichero OpenAPI, `detect()` devuelve 0.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contract/scanner.interface.js";

/** Buscar OpenAPI en las localizaciones más comunes. */
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
type HttpMethod = (typeof HTTP_METHODS)[number];

function isHttpMethod(m: string): m is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(m.toLowerCase());
}

// ---------------------------------------------------------------------------
// YAML parser (NO usamos dependencias externas — subset suficiente)
// ---------------------------------------------------------------------------

/**
 * Parser YAML mínimo (sin dependencias). Soporta lo que OpenAPI usa:
 * mappings, sequences, scalars (string/number/bool/null), comentarios
 * `#`, y multi-line scalars `|` y `>`. Lo demás cae al string literal.
 *
 * Si el YAML es complejo, lo aborta con un error claro y el caller
 * puede convertir el spec a JSON por su cuenta.
 */
export function parseYamlLite(src: string): unknown {
  // Sanitizar: tabuladores no son válidos en YAML.
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
            // Continuar el map en líneas siguientes
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
      // Saltar comentarios `#` también dentro de mappings.
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
    // Muy habitual en specs OpenAPI escritos a mano para properties y
    // parameters. Sin esto, todo el schema se quedaba como literal y los
    // campos salían con `type: "any"`.
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
    // Anchors / aliases no se soportan; devolver literal.
    return s;
  }

  /**
   * Índice del `:` que separa key y valor en una entrada de flow mapping.
   * Ignora los `:` dentro de quotes o de `[]`/`{}` anidados, para no
   * partir por el `:` de `{ default: { a: 1 } }` ni por el de una URL.
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

  async detect(projectRoot: string): Promise<number> {
    for (const rel of OPENAPI_CANDIDATES) {
      if (existsSync(join(projectRoot, rel))) return 1;
    }
    return 0;
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

export interface OpenApiScannerOptions {
  /** Path explícito al spec. Si se da, ignora OPENAPI_CANDIDATES. */
  readonly specPath?: string;
  /** Base path a prepender a todas las URIs (ej. "/api/v2"). */
  readonly basePath?: string;
}

export class OpenApiScanner implements IRouteScanner {
  readonly framework = "openapi" as const;

  constructor(private readonly opts: OpenApiScannerOptions = {}) {}

  matches(_match: IProjectMatch): boolean {
    return _match.framework === "openapi";
  }

  async scan(match: IProjectMatch): Promise<ReadonlyArray<ParsedRoute>> {
    const specRel = this.opts.specPath ?? match.artifacts[0];
    if (!specRel) return [];
    const absPath = resolve(match.projectRoot, specRel);
    let raw: string;
    try {
      raw = await readFile(absPath, "utf8");
    } catch {
      return [];
    }
    let spec: any;
    try {
      if (specRel.endsWith(".json")) {
        spec = JSON.parse(raw);
      } else {
        spec = parseYamlLite(raw);
      }
    } catch (e) {
      // Syntax error en YAML/JSON: abortar limpio.
      throw new Error(`OpenApiScanner: cannot parse ${specRel}: ${(e as Error).message}`);
    }
    const basePath: string =
      this.opts.basePath ?? (typeof spec.basePath === "string" ? spec.basePath : "");
    const paths = spec.paths ?? {};
    const out: ParsedRoute[] = [];
    for (const [pathTemplate, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== "object") continue;
      const item = pathItem as Record<string, unknown>;
      // Parámetros a nivel de path (compartidos por todos los métodos).
      const pathLevelParams = Array.isArray(item.parameters) ? item.parameters : [];
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
        // detectar parameters a nivel de operación
        const opParams = Array.isArray(opObj.parameters) ? opObj.parameters : [];
        const params = [...pathLevelParams, ...opParams];
        if (params.length > 0) {
          (out[out.length - 1] as any).__params = params;
        }
      }
    }
    return out;
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

  async supports(_r: ParsedRoute, _m: IProjectMatch): Promise<boolean> {
    return Boolean((_r as any).__params) || _m.framework === "openapi";
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
  ): Promise<Awaited<ReturnType<IValidationSpecProvider["resolve"]>>> {
    const specRel = this.getSpecPath(match);
    if (!specRel) return { endpointKey: keyOf(route), fields: [] };
    const absPath = resolve(match.projectRoot, specRel);
    let raw: string;
    try {
      raw = await readFile(absPath, "utf8");
    } catch {
      return { endpointKey: keyOf(route), fields: [] };
    }
    let spec: any;
    try {
      spec = specRel.endsWith(".json") ? JSON.parse(raw) : parseYamlLite(raw);
    } catch {
      return { endpointKey: keyOf(route), fields: [] };
    }
    const pathItem = (spec.paths ?? {})[route.rawUri];
    if (!pathItem) return { endpointKey: keyOf(route), fields: [] };
    const op = pathItem[route.method.toLowerCase()];
    if (!op) return { endpointKey: keyOf(route), fields: [] };
    const fields: IValidationSpec[] = [];
    const params = [
      ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
      ...(Array.isArray(op.parameters) ? op.parameters : []),
    ];
    for (const p of params) {
      if (!p || typeof p !== "object") continue;
      const pObj = p as Record<string, unknown>;
      // Resolver $ref en parameters (ej. `{$ref: '#/components/parameters/X'}`).
      const resolvedP = resolveRef(pObj, spec) ?? pObj;
      // name, in, required pueden estar en el $ref resuelto o en el original.
      const name = String(resolvedP.name ?? pObj.name ?? "");
      const inLoc = String(resolvedP.in ?? pObj.in ?? "query") as IValidationSpec["location"];
      const required = Boolean(resolvedP.required ?? pObj.required);
      const schema = (resolvedP.schema ?? {}) as OpenApiSchema;
      fields.push(schemaToField(name, inLoc, required, schema));
    }
    // Request body (JSON)
    const content = (op.requestBody as Record<string, unknown> | undefined)?.content;
    const json = (content as Record<string, unknown> | undefined)?.["application/json"];
    if (json && typeof json === "object") {
      const raw = ((json as Record<string, unknown>).schema ?? {}) as Record<string, unknown>;
      // Resolver $ref top-level (ej. `{$ref: '#/components/schemas/X'}`).
      const resolved = resolveRef(raw, spec);
      const schema = (resolved ?? raw) as OpenApiSchema;
      // allOf: mergear properties + required de cada subschema.
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
 * Resuelve un $ref local (`#/components/schemas/X`) en el spec.
 * Soporta un solo nivel de indirección. Devuelve `null` si no resuelve.
 */
function resolveRef(obj: any, spec: any): any | null {
  if (!obj || typeof obj !== "object") return null;
  const ref = obj.$ref;
  if (typeof ref !== "string") return null;
  if (!ref.startsWith("#/")) return null;
  const path = ref.slice(2).split("/");
  let current: any = spec;
  for (const part of path) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      return null;
    }
  }
  return current;
}

/**
 * Combina un schemaOpenAPI con `allOf: [...]` más profundo.
 *
 * Soporta:
 * - `allOf: [{schemaBody}, {schemaBody2}]` → mergea properties y required.
 * - `$ref` en items de `allOf`: se resuelve si `spec` se pasa.
 * - `oneOf`/`anyOf`: NO se mergea (mejor omitir que adivinar).
 */
function mergeAllOf(
  schema: any,
  spec?: any,
): { properties: Record<string, OpenApiSchema>; required: string[] } {
  const properties: Record<string, OpenApiSchema> = {};
  const required: string[] = [];
  if (!schema || typeof schema !== "object") return { properties, required };
  // Resolver $ref en el schema raíz.
  if (typeof schema.$ref === "string" && spec) {
    const resolved = resolveRef(schema, spec);
    if (resolved) return mergeAllOf(resolved, spec);
  }
  // Propiedades del schema raíz.
  for (const [k, v] of Object.entries(schema.properties ?? {})) {
    properties[k] = v as OpenApiSchema;
  }
  for (const r of schema.required ?? []) {
    if (typeof r === "string" && !required.includes(r)) required.push(r);
  }
  // allOf: mergear cada subschema.
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      const merged = mergeAllOf(sub, spec);
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
