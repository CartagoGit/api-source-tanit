/**
 * `FastifyScanner` — `IProjectScanner` + `IRouteScanner` +
 * `IValidationSpecProvider` para Fastify.
 *
 * Detección:
 *   - `fastify` en las dependencias del `package.json`.
 *
 * Parsing de rutas, las tres formas que usa Fastify:
 *   - `app.get("/users", handler)` — la corta, igual que Express.
 *   - `app.route({ method: "GET", url: "/users", … })` — la larga.
 *   - Prefijos de plugin: `app.register(rutas, { prefix: "/api/v1" })`.
 *
 * Validación:
 *   Fastify es el único de los grandes de Node que lleva el esquema
 *   **dentro de la declaración de la ruta**:
 *
 *     app.post("/users", {
 *       schema: {
 *         body: { type: "object", required: ["email"], properties: {…} },
 *         querystring: {…},
 *         headers: {…},
 *       },
 *     }, handler);
 *
 *   Eso es JSON Schema, o sea información de tipos **exacta** en vez de
 *   inferida. Es la mejor fuente que puede tener un scanner, y por eso
 *   este framework se lee mejor que los que dependen de una librería
 *   externa de validación.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { collectFiles, isSourceJsTsFile } from "../../core/helpers/fs-walk.helper.js";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import {
  findAllBalanced,
  findClosingParen,
  stripJsComments,
} from "../../core/helpers/source-scan.helper.js";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import { relative } from "node:path";
import type {
  IEndpointValidation,
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../core/contracts/scanner.interface.js";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"] as const;

/** `app.get("/x"` y compañía. */
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

async function readPackageJson(projectRoot: string): Promise<Record<string, unknown> | null> {
  const path = join(projectRoot, "package.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function dependsOnFastify(pkg: Record<string, unknown> | null): boolean {
  if (!pkg) return false;
  const deps = {
    ...((pkg["dependencies"] as Record<string, string>) ?? {}),
    ...((pkg["devDependencies"] as Record<string, string>) ?? {}),
  };
  return Object.keys(deps).some((name) => name === "fastify" || name.startsWith("@fastify/"));
}

export class FastifyProjectScanner implements IProjectScanner {
  readonly framework = "fastify" as const;

  async detect(projectRoot: string): Promise<number> {
    const pkg = await readPackageJson(projectRoot);
    if (!dependsOnFastify(pkg)) return 0;
    // El paquete `fastify` a secas es señal fuerte; solo un plugin
    // `@fastify/*` puede ser un proyecto que lo use de refilón.
    const deps = {
      ...((pkg?.["dependencies"] as Record<string, string>) ?? {}),
      ...((pkg?.["devDependencies"] as Record<string, string>) ?? {}),
    };
    return "fastify" in deps ? 1 : 0.6;
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

  /** `MÉTODO uri` → el JSON Schema declarado en esa ruta. */
  private readonly schemas = new Map<string, string>();

  matches(match: IProjectMatch): boolean {
    return match.framework === "fastify";
  }

  /** Lo consume `FastifySchemaProvider`, que corre después del escaneo. */
  schemaFor(method: string, uri: string): string | undefined {
    return this.schemas.get(`${method} ${uri}`);
  }

  async scan(match: IProjectMatch): Promise<ReadonlyArray<ParsedRoute>> {
    const files = await collectFiles(match.projectRoot, isSourceJsTsFile);
    const routes: ParsedRoute[] = [];

    // Lectura en paralelo con tope, entregada en el orden de
    // entrada: la colección tiene que salir igual cada vez.
    for await (const { path: file, text: raw } of readFilesInOrder(files)) {
      if (!/\bfastify\b|\.route\s*\(|\.(get|post|put|patch|delete)\s*\(/i.test(raw)) continue;

      const source = stripJsComments(raw);
      const sourceFile = relative(match.projectRoot, file);
      const prefix = prefixOf(source);

      for (const { route, callStart, callEnd } of parseShortRoutes(
        source,
        prefix,
        sourceFile,
      )) {
        routes.push(route);
        const schema = schemaInCall(source, callStart, callEnd);
        if (schema) this.schemas.set(`${route.method} ${route.uri}`, schema);
      }
      for (const route of parseRouteObjects(source, prefix, sourceFile)) {
        routes.push(route);
      }
    }

    return dedupe(routes);
  }
}

/**
 * Prefijo del fichero, si registra sus rutas bajo uno.
 *
 * Fastify lo declara en el `register` del plugin, que suele estar en
 * OTRO fichero (el que monta la app). Aquí se coge el que esté en el
 * mismo fichero, que cubre el caso de un plugin autocontenido; el
 * montaje cruzado entre ficheros requiere seguir imports y queda para
 * el motor de AST (p00030).
 */
function prefixOf(source: string): string {
  const prefixes = [...source.matchAll(REGISTER_PREFIX_RE)].map((m) => m[2] ?? "");
  return prefixes.length === 1 ? (prefixes[0] ?? "") : "";
}

/** Una ruta corta con los límites de su llamada, para acotar el schema. */
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
  for (const match of source.matchAll(SHORT_ROUTE_RE)) {
    const method = (match[1] ?? "").toUpperCase();
    const rawUri = match[3] ?? "";
    if (!rawUri.startsWith("/")) continue;

    const parenAt = source.indexOf("(", match.index ?? 0);
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
): ParsedRoute[] {
  const routes: ParsedRoute[] = [];

  for (const call of findAllBalanced(source, ROUTE_OBJECT_RE)) {
    const body = source.slice(call.callStart, call.callEnd);
    const rawUri = URL_FIELD_RE.exec(body)?.[2];
    if (!rawUri) continue;

    // `method` admite string o array: `method: ["GET", "HEAD"]`.
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
        lineNumber: lineOf(source, call.callStart),
        method: method.toUpperCase(),
        uri: joinRoutePath(prefix, rawUri),
        rawUri,
        sourceFile,
        prefixChain: prefix ? [prefix] : [],
      });
    }
  }
  return routes;
}

/**
 * El `schema: {…}` de una ruta corta, si lo declara.
 *
 * Se busca **dentro de los paréntesis de la propia llamada**, no en una
 * ventana de caracteres. Con una ventana, un `app.get("/health", h)` sin
 * esquema se quedaba con el del `app.post("/users", { schema })` de
 * abajo, y el endpoint salía con reglas que no eran suyas.
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

/** Número de línea (1-based) de un desplazamiento del fichero. */
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
 * Reglas de validación desde el JSON Schema de la propia ruta.
 *
 * A diferencia de zod o Joi, aquí no hay que interpretar el DSL de una
 * librería: Fastify usa JSON Schema, que ya dice el tipo, qué campos son
 * obligatorios y los límites. Es información exacta, no inferida.
 */
export class FastifySchemaProvider implements IValidationSpecProvider {
  readonly framework = "fastify" as const;

  constructor(private readonly scanner: FastifyRouteScanner) {}

  async supports(route: ParsedRoute, _match: IProjectMatch): Promise<boolean> {
    return this.scanner.schemaFor(route.method, route.uri) !== undefined;
  }

  async resolve(route: ParsedRoute, _match: IProjectMatch): Promise<IEndpointValidation> {
    const endpointKey = `${route.method} ${route.uri}`;
    const json = this.scanner.schemaFor(route.method, route.uri);
    return { endpointKey, fields: json ? parseFastifySchema(json) : [] };
  }
}

/** Secciones del `schema` de Fastify → dónde va el campo. */
const SECTION_TO_LOCATION: Record<string, IValidationSpec["location"]> = {
  body: "body",
  querystring: "query",
  query: "query",
  params: "path",
  headers: "header",
};

/** Tipos de JSON Schema → los del contrato. */
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

/** El `{…}` que sigue a `<name>:`, con las llaves equilibradas. */
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

/** Pares `clave: {…}` del primer nivel de un bloque de propiedades. */
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
