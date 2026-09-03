/**
 * `ExpressRouteScanner` — implementación de `IProjectScanner` + `IRouteScanner`
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
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import { isRecord, parseJson } from "../../core/helpers/parse-json.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contracts/interfaces/core/scanner.interface.js";
import { collectFilesFrom, isSourceJsTsFile } from "../../core/helpers/fs-walk.helper.js";
import { countLinesBefore, findAllBalanced, findOutsideStrings, findNearestBalanced, stripJsComments } from "../../core/helpers/source-scan.helper.js";
import { joiFieldToSpec, parseJoiObjectLiteral } from "../parsers/joi-schema.helper.js";
import { parseZodObjectLiteral, zodFieldToSpec } from "../parsers/zod-schema.helper.js";
import type { IBalancedCall } from "../../contracts/interfaces/core/helpers.interface.js";

/**
 * Frameworks de Node que este scanner cubre por parecido con Express.
 *
 * `fastify` estaba aquí y se ha ido: tiene su propio scanner, que lee el
 * JSON Schema que Fastify declara DENTRO de cada ruta. Eso es
 * información de tipos exacta; esto solo reconoce la forma de la
 * llamada. Dejarlo aquí hacía que un proyecto Fastify casara con los
 * dos y se mezclaran dos lecturas, una buena y otra a medias.
 *
 * Koa y Hapi siguen porque no tienen scanner propio todavía.
 */
const FRAMEWORK_PACKAGES = ["express", "@koa/router", "@hapi/hapi", "koa"];
const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"];

// Regex para `<ident>.METHOD(path, handler)` o `app.METHOD(path, handler)`.
// Captura: 1=ident (router name), 2=method, 3=path (entre comilla simple o doble).
// Usa lookbehind negativo para evitar que matchee `myRouter` SIN `Router` antes.
// `\s*` cruza saltos de línea, que es lo que permite reconocer la forma
// multilínea: `router.post(\n  "/x",\n  handler,\n)`.
const APP_METHOD_RE =
  /([a-zA-Z_$][\w$]*)\s*\.\s*(get|post|put|delete|patch|head|options)\s*\(\s*(['"])([^'"\n]+)\3/gi;
// Regex para `Router({ prefix: 'api/v1' })`.
const ROUTER_PREFIX_RE = /Router\s*\(\s*\{[^}]*prefix\s*:\s*['"]([^'"]+)['"]/gi;
// Regex para `app.use('/prefix', router)`.
const APP_USE_PREFIX_RE = /\bapp\s*\.\s*use\s*\(\s*(['"])([^'"]+)\1\s*,\s*([a-zA-Z_$][\w$]*)/gi;
// Regex para `app.use('/prefix')` (sin router, modo middleware).
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
    const parsed = parseJson(await readFile(pkgPath, "utf8"));
    if (!parsed.ok || !isRecord(parsed.value)) return 0;
    const deps = {
      ...((parsed.value["dependencies"] as Record<string, string>) ?? {}),
      ...((parsed.value["devDependencies"] as Record<string, string>) ?? {}),
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

interface ParsedModule {
  file: string;
  routes: Array<{ method: string; path: string; line: number; routerName?: string }>;
  routerPrefixes: Map<string, string>; // varName → prefix
  appUsePrefixes: Map<string, string>; // varName → prefix
}

/**
 * `raw` llega ya leído, no lo lee esta función.
 *
 * Es lo que permite que quien llama pida los ficheros en paralelo con
 * tope en vez de uno detrás de otro. La alternativa —dejar la lectura
 * aquí dentro— obliga a que el bucle de fuera espere a cada disco.
 */
function parseModule(file: string, raw: string): ParsedModule {
  const text = stripJsComments(raw);
  const lines = text.split("\n");
  const routes: Array<{ method: string; path: string; line: number; routerName?: string }> = [];
  const routerPrefixes = new Map<string, string>();
  const appUsePrefixes = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // router = Router({ prefix: '/api/v1' })
    const rpM = new RegExp(ROUTER_PREFIX_RE.source, "gi").exec(line);
    if (rpM?.[1]) {
      // Igual que arriba: todas las declaraciones de la línea, no solo
      // la primera.
      const varReg = /([a-zA-Z_$][\w$]*)\s*=\s*(?:express\.)?Router/g;
      let varMatch: RegExpExecArray | null;
      while ((varMatch = varReg.exec(line)) !== null) {
        if (varMatch[1]) routerPrefixes.set(varMatch[1], rpM[1]);
      }
    }

    // app.use('/prefix', router) → el router montado hereda el prefijo.
    // Se recorren TODAS las coincidencias de la línea: con `.exec()` una
    // sola vez, `app.use("/v1", a); app.use("/v2", b);` en la misma línea
    // perdía el segundo montaje y sus rutas salían sin prefijo.
    const auReg = new RegExp(APP_USE_PREFIX_RE.source, "gi");
    let auM: RegExpExecArray | null;
    while ((auM = auReg.exec(line)) !== null) {
      if (auM[2] && auM[3]) appUsePrefixes.set(auM[3], auM[2]);
    }

  }

  // Las rutas se buscan sobre el fichero ENTERO, no línea a línea.
  //
  // Dos motivos, los dos medidos:
  //
  //   1. **Multilínea.** `router.post(\n  "/x",\n  handler,\n)` es la forma
  //      normal de escribirlo en cuanto hay middlewares, y un bucle por
  //      líneas no ve el path porque está en otra que la llamada.
  //   2. **Cadenas.** `const ayuda = 'usa router.get("/x")'` producía un
  //      endpoint que no existe. `findOutsideStrings` enmascara el
  //      contenido de las cadenas antes de buscar, así que una llamada
  //      que vive dentro de una desaparece.
  //
  // Es lo que la propuesta del motor de AST venía a resolver, sin el
  // parser: el problema no era el regex, era mirar una línea cada vez.
  for (const { match } of findOutsideStrings(text, APP_METHOD_RE)) {
    const ident = (match[1] ?? "").trim();
    const method = (match[2] ?? "").toLowerCase();
    const path = (match[4] ?? "").trim();
    if (!HTTP_METHODS.includes(method)) continue;
    if (!path.startsWith("/")) continue;
    const line = countLinesBefore(text, match.index) + 1;
    // Heurística: el ident es un router (NO 'app', 'server', 'fastify', 'koa')
    if (ident !== "app" && ident !== "server" && ident !== "fastify" && ident !== "koa") {
      routes.push({ method, path, line, routerName: ident });
    } else {
      routes.push({ method, path, line });
    }
  }

  // Hapi: server.route({ method, path, ... })
  for (const { match } of findOutsideStrings(text, HAPI_ROUTE_RE)) {
    const method = (match[1] ?? "").toLowerCase();
    const path = (match[3] ?? "").trim();
    if (!HTTP_METHODS.includes(method)) continue;
    if (!path.startsWith("/")) continue;
    routes.push({ method, path, line: countLinesBefore(text, match.index) + 1 });
  }

  return { file, routes, routerPrefixes, appUsePrefixes };
}

// ---------------------------------------------------------------------------
// Route scanner
// ---------------------------------------------------------------------------

export class ExpressRouteScanner implements IRouteScanner {
  readonly framework = "express" as const;

  matches(_match: IProjectMatch): boolean {
    return _match.framework === "express";
  }

  async scan(match: IProjectMatch): Promise<ReadonlyArray<ParsedRoute>> {
    const files = await collectJsFiles(match.projectRoot);
    const modules: ParsedModule[] = [];
    // En paralelo con tope, entregados en el orden de entrada: la
    // colección tiene que salir igual en cada ejecución.
    for await (const { path, text } of readFilesInOrder(files)) {
      modules.push(parseModule(path, text));
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
  const text = stripJsComments(raw);
  const lines = text.split("\n");

  // 1) Detectar qué framework usa el handler.
  //    Estrategia (orden de prioridad):
  //    a. **Schema usado en el handler**: parsear el cuerpo del handler
  //       buscando `SchemaName.parse(req.body)` o `SchemaName.validate(req.body)`.
  //       Si el nombre del schema está declarado como `= z.object(...)`, usar zod.
  //       Si está como `= Joi.object(...)`, usar Joi.
  //    b. **Anterior más cercano no-header**: si el handler no usa
  //       `.parse()` ni `.validate()`, usar el schema zod/jod anterior y más
  //       cercano (skip schemas que parezcan headers).
  //    c. **Cualquier más cercano**: si no hay nada body-like, fallback.
  const startLine = Math.max(0, route.lineNumber - 1);
  const handlerBody = collectHandlerBody(lines, startLine);
  const referencedSchemaName = handlerBody
    ? findReferencedSchemaName(handlerBody)
    : null;
  // Resolver a qué framework pertenece el schema referenciado.
  let prefer: "zod" | "joi" | null = null;
  if (referencedSchemaName) {
    if (new RegExp(`\\b${referencedSchemaName}\\s*=\\s*z\\s*\\.\\s*object`).test(text)) {
      prefer = "zod";
    } else if (new RegExp(`\\b${referencedSchemaName}\\s*=\\s*Joi\\s*\\.\\s*object`).test(text)) {
      prefer = "joi";
    }
  }

  // 2) zod primero, Joi como segunda opción. La selección del schema
  //    es idéntica en ambos casos, solo cambia la librería.
  for (const library of ["zod", "joi"] as const) {
    // Si el handler referencia explícitamente un schema de la OTRA
    // librería, no adivinamos con esta.
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

/** Ventana (chars) hacia atrás donde buscar `const X = z.object(`. */
const SCHEMA_DECL_LOOKBEHIND = 80;

/**
 * Elige qué `<lib>.object({...})` del archivo describe el body de este
 * handler, en tres pasos de confianza decreciente:
 *
 *   1. El schema que el handler referencia por nombre
 *      (`createUserSchema.parse(req.body)`).
 *   2. El schema declarado ANTES del handler más cercano que tenga
 *      campos y no parezca un schema de headers.
 *   3. El más cercano en líneas, en cualquier dirección.
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

  // 2) El anterior más cercano que parezca un body.
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

  // 3) El más cercano en valor absoluto.
  return findNearestBalanced(text, objectRe, startLine);
}

/**
 * Busca el `headers: <lib>.object({...})` más cercano al handler y
 * devuelve sus campos con `location: "header"`.
 *
 * Los schemas de headers se declaran normalmente en el objeto de
 * configuración de la ruta, justo encima o debajo del handler, así que
 * la proximidad en líneas es el mejor desempate disponible.
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
 * Recoge el cuerpo del handler (el callback `app.METHOD('/x', (req, res) => { ... })`)
 * desde `startLine` hasta el `}` de cierre del callback.
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
 * Busca el nombre del schema referenciado en el cuerpo del handler:
 *   `const body = CreateUserSchema.parse(req.body);` → "CreateUserSchema"
 *
 * Busca `.parse(req.body)` o `.validate(req.body)`.
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
 * Heurística: ¿este schema parece un HEADER schema?
 *
 * Reconoce:
 * - Cualquier key con guión (kebab-case HTTP): `X-API-Key`, `Content-Type`, …
 * - Headers comunes sin guión: `Authorization`, `Accept`, `User-Agent`, …
 *
 * Si TODAS las keys del schema son headers, devolvemos true.
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

