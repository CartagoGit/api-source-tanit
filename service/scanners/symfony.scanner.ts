/**
 * `SymfonyScanner` — implementación de `IProjectScanner` + `IRouteScanner`
 * para proyectos Symfony (5.x, 6.x, 7.x).
 *
 * Detección:
 *   - `composer.json` con `require` que contenga `symfony/framework-bundle`
 *     o `symfony/routing`.
 *   - `bin/console` (heurístico) o `app/AppKernel.php` (legacy 4.x).
 *
 * Parsing de rutas:
 *   - YAML: `config/routes.yaml`, `config/routes/*.yaml` (no anidados).
 *   - YAML / `*.php` (PHP routes): best-effort regex.
 *   - PHP attributes: `Route('/users', methods: ['GET'])` en
 *     `src/Controller/`.
 *
 * Validation:
 *   - `SymfonyAttributesValidationProvider` extrae constraints de
 *     Doctrine NotBlank, Email, Length, Choice, Range, etc., desde el
 *     método del controller inspeccionando parámetros tipados.
 *
 * Limitaciones:
 *   - Solo PYTHON Y YAML de rutas (no PHP routes complejos tipo RouterInterface).
 *   - No resuelve `AsEventListener`, `AsCommand`, etc.
 *   - Constraints deben estar en el método (no en una Entity separada).
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contract/scanner.interface.js";
import { parseYamlLite } from "./openapi.scanner.js";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"];
const SYMFONY_REQUIRE_KEYS = ["symfony/framework-bundle", "symfony/routing"];

/**
 * Lee composer.json y devuelve true si alguna de las SYMFONY_REQUIRE_KEYS
 * está en `require` o `require-dev`.
 */
async function isSymfonyProject(projectRoot: string): Promise<{
  yes: boolean;
  composerJson?: Record<string, unknown>;
}> {
  const composerPath = join(projectRoot, "composer.json");
  if (!existsSync(composerPath)) return { yes: false };
  let raw: string;
  try {
    raw = await readFile(composerPath, "utf8");
  } catch {
    return { yes: false };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { yes: false };
  }
  const req = (parsed.require ?? {}) as Record<string, string>;
  const reqDev = (parsed["require-dev"] ?? {}) as Record<string, string>;
  for (const key of SYMFONY_REQUIRE_KEYS) {
    if (typeof req[key] === "string" || typeof reqDev[key] === "string") {
      return { yes: true, composerJson: parsed };
    }
  }
  return { yes: false };
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export class SymfonyProjectScanner implements IProjectScanner {
  readonly framework = "symfony" as const;

  async detect(projectRoot: string): Promise<number> {
    const det = await isSymfonyProject(projectRoot);
    if (!det.yes) return 0;
    const hasBinConsole = existsSync(join(projectRoot, "bin", "console"));
    const hasConfigRoutes = existsSync(join(projectRoot, "config", "routes.yaml"));
    const hasSrcController = existsSync(join(projectRoot, "src", "Controller"));
    if (hasBinConsole) return 1;
    if (hasConfigRoutes || hasSrcController) return 0.8;
    return 0.4;
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const artifacts: string[] = ["composer.json"];
    if (existsSync(join(projectRoot, "config", "routes.yaml"))) {
      artifacts.push("config/routes.yaml");
    }
    const routesDir = join(projectRoot, "config", "routes");
    if (existsSync(routesDir)) artifacts.push("config/routes");
    if (existsSync(join(projectRoot, "src", "Controller"))) {
      artifacts.push("src/Controller");
    }
    return { framework: "symfony", projectRoot, artifacts };
  }
}

// ---------------------------------------------------------------------------
// Route scanner
// ---------------------------------------------------------------------------

export class SymfonyRouteScanner implements IRouteScanner {
  readonly framework = "symfony" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "symfony";
  }

  async scan(match: IProjectMatch): Promise<ParsedRoute[]> {
    const out: ParsedRoute[] = [];
    const projectRoot = match.projectRoot;
    // 1) YAML routes (config/routes.yaml + config/routes/*.yaml).
    const topRoute = join(projectRoot, "config", "routes.yaml");
    if (existsSync(topRoute)) {
      out.push(...(await parseRoutesYamlFile(topRoute, "config/routes.yaml", projectRoot)));
    }
    const routesDir = join(projectRoot, "config", "routes");
    if (existsSync(routesDir)) {
      let entries: string[] = [];
      try {
        entries = await readdir(routesDir);
      } catch {
        entries = [];
      }
      for (const entry of entries) {
        if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
        const rel = `config/routes/${entry}`;
        const abs = join(routesDir, entry);
        out.push(...(await parseRoutesYamlFile(abs, rel, projectRoot)));
      }
    }
    // 2) PHP attributes en src/Controller/**.
    const controllerDir = join(projectRoot, "src", "Controller");
    if (existsSync(controllerDir)) {
      out.push(...(await parseControllerAttributes(controllerDir, projectRoot)));
    }
    // Un mismo endpoint puede llegar por dos vías: declarado en YAML y
    // además como `#[Route]` en el controller (o vía `resource:` que ya
    // apunta al mismo fichero). Symfony lo registra una sola vez.
    return dedupeRoutes(out);
  }
}

/**
 * Colapsa rutas equivalentes (mismo método y misma URI salvo barra final)
 * quedándose con la más informativa: la que viene de un `#[Route]` en el
 * controller trae `lineNumber` y el nombre del método, que es lo que el
 * validation provider necesita para leer los `#[Assert\...]`.
 */
function dedupeRoutes(routes: ParsedRoute[]): ParsedRoute[] {
  const byKey = new Map<string, ParsedRoute>();
  for (const route of routes) {
    const uri = normalizeSymfonyUri(route.uri);
    const key = `${route.method} ${uri}`;
    const current = byKey.get(key);
    const candidate: ParsedRoute = { ...route, uri, rawUri: normalizeSymfonyUri(route.rawUri) };
    if (!current || scoreRoute(candidate) > scoreRoute(current)) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()];
}

/** Quita la barra final (`/users/` y `/users` son la misma ruta). */
function normalizeSymfonyUri(uri: string): string {
  const collapsed = uri.replace(/\/+/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/$/, "") : collapsed;
}

/** Más alto = más información utilizable aguas abajo. */
function scoreRoute(route: ParsedRoute): number {
  return (route.lineNumber > 0 ? 2 : 0) + (route.description ? 1 : 0);
}

/**
 * Parsea un fichero YAML de rutas Symfony. Soporta:
 *   - routing directo:
 *       user_show:
 *         path: /users/{id}
 *         controller: App\Controller\UserController::show
 *         methods: [GET]
 *   - resource include:
 *       users:
 *         resource: ../src/Controller/UserController.php
 *         prefix: /api
 *   - type: attribute (Symfony 5.3+)
 */
async function parseRoutesYamlFile(
  absPath: string,
  relPath: string,
  projectRoot: string,
): Promise<ParsedRoute[]> {
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch {
    return [];
  }
  let parsed: any;
  try {
    parsed = parseYamlLite(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const out: ParsedRoute[] = [];
  for (const [name, body] of Object.entries(parsed as Record<string, unknown>)) {
    if (!body || typeof body !== "object") continue;
    const bodyObj = body as Record<string, unknown>;
    const path = typeof bodyObj.path === "string" ? bodyObj.path : null;
    const controller = typeof bodyObj.controller === "string" ? bodyObj.controller : null;
    const methods = parseMethods(bodyObj.methods);
    const prefix = typeof bodyObj.prefix === "string" ? bodyObj.prefix : "";
    const resource = typeof bodyObj.resource === "string" ? bodyObj.resource : null;
    if (path && controller && methods.length > 0) {
      const fullPath = (prefix + path).replace(/\/+/g, "/");
      for (const method of methods) {
        out.push({
          method: method.toUpperCase(),
          uri: fullPath,
          rawUri: fullPath,
          sourceFile: relPath,
          lineNumber: 0,
          prefixChain: prefix ? [prefix] : [],
          displayName: name,
          description: typeof bodyObj.methods === "string" ? bodyObj.methods : "",
        });
      }
    } else if (resource && /\.\/.*Controller.*\.php/.test(resource)) {
      // Apunta a un controller: parseamos sus attributes.
      // Resolución: ../../src/Controller/... (asumimos config/ relativo)
      const ctrlAbs = join(absPath, "..", "..", resource);
      // OJO: el tercer argumento es el projectRoot, no el YAML de origen.
      // Pasar `relPath` aquí dejaba `sourceFile` como ruta absoluta y el
      // validation provider no encontraba nunca el controller.
      out.push(...(await parseControllerAttributes(ctrlAbs, projectRoot, prefix)));
    }
  }
  return out;
}

function parseMethods(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => String(x).toLowerCase()).filter((m) => HTTP_METHODS.includes(m));
  }
  if (typeof v === "string") {
    return v
      .split(/[|,]/g)
      .map((s) => s.trim().toLowerCase())
      .filter((m) => HTTP_METHODS.includes(m));
  }
  return [];
}

/**
 * Ruta relativa al proyecto en formato POSIX.
 *
 * Se resuelven ambos lados a absoluto antes de comparar: el projectRoot
 * puede llegar como `./algo` y una comparación textual con `startsWith`
 * dejaba `sourceFile` en absoluto, con lo que el validation provider
 * construía `join(projectRoot, sourceFile)` y no encontraba el fichero.
 */
function toProjectRelative(absPath: string, projectRoot: string): string {
  return relative(resolve(projectRoot), resolve(absPath)).split(sep).join("/");
}

/**
 * Recorre src/Controller recursivamente y extrae `#[Route(...)]`
 * de cada método público.
 */
async function parseControllerAttributes(
  controllerPath: string,
  projectRoot: string,
  prefix = "",
): Promise<ParsedRoute[]> {
  const out: ParsedRoute[] = [];
  const isFile = controllerPath.endsWith(".php");
  if (isFile) {
    out.push(
      ...(await parseSingleController(
        controllerPath,
        toProjectRelative(controllerPath, projectRoot),
        prefix,
      )),
    );
    return out;
  }
  // Directorio: recorrido recursivo.
  let entries: string[];
  try {
    entries = await readdir(controllerPath);
  } catch {
    return [];
  }
  for (const entry of entries) {
    const child = join(controllerPath, entry);
    if (entry.endsWith(".php")) {
      out.push(
        ...(await parseSingleController(child, toProjectRelative(child, projectRoot), prefix)),
      );
    } else if (!entry.includes(".")) {
      out.push(...(await parseControllerAttributes(child, projectRoot, prefix)));
    }
  }
  return out;
}

/**
 * Regex para `#[Route(path: '/users', methods: ['GET'])]` o variantes.
 * Captura: 1=path (string), 2=methods (array o string).
 */
const ATTR_ROUTE_RE =
  /#\[Route\s*\(([^)]*)\)\s*\]/gi;
const ATTR_PATH_RE = /['"]([^'"]+)['"]/;
const ATTR_METHODS_RE = /methods\s*:\s*\[([^\]]*)\]/i;
const ATTR_METHOD_RE = /methods\s*:\s*['"]([^'"]+)['"]/i;
const ATTR_NAME_RE = /name\s*:\s*['"]([^'"]+)['"]/i;

async function parseSingleController(
  absPath: string,
  relPath: string,
  prefix = "",
): Promise<ParsedRoute[]> {
  const out: ParsedRoute[] = [];
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch {
    return [];
  }
  const text = stripPhpComments(raw);
  const lines = text.split("\n");

  // 1) Detectar `#[Route('/prefix')] class Name { ... }` para class prefix.
  //    En Symfony el `#[Route(...)]` va ANTES del `class`. Buscamos
  //    `class <Name>` y luego un `#[Route]` en las 3 líneas anteriores.
  let classPrefix = prefix;
  let classRouteIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/class\s+\w+/.test(line)) {
      // Buscar `#[Route(...)]` en las 3 líneas ANTERIORES.
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const m = ATTR_ROUTE_RE.exec(lines[j] ?? "");
        if (m) {
          ATTR_ROUTE_RE.lastIndex = 0;
          const args = m[1] ?? "";
          const pathMatch = /^\s*['"]([^'"]*)['"]/.exec(args);
          const classPath = pathMatch?.[1] ?? "";
          // Solo aplicar como class prefix si NO tiene methods.
          const hasMethods = /methods\s*:/i.test(args);
          if (!hasMethods && classPath) {
            classPrefix = (prefix + classPath).replace(/\/+/g, "/");
            classRouteIdx = j;
          }
          break;
        }
      }
      break;
    }
  }

  // 2) Iterar `#[Route(...)]` en métodos (después de classRouteIdx).
  //    Esta estrategia reemplaza la convención anterior: ahora acepta
  //    `#[Route('/path', methods: ['POST'])]` en métodos.
  const startIter = classRouteIdx >= 0 ? classRouteIdx + 1 : 0;
  for (let i = startIter; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = ATTR_ROUTE_RE.exec(line);
    if (!m) continue;
    ATTR_ROUTE_RE.lastIndex = 0;
    const attrArgs = m[1] ?? "";
    const pathMatch = /^\s*['"]([^'"]*)['"]/.exec(attrArgs);
    const path = pathMatch?.[1] ?? "";
    let methods: string[] = [];
    const methodsArr = ATTR_METHODS_RE.exec(attrArgs);
    if (methodsArr?.[1]) {
      methods = methodsArr[1]
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
    if (methods.length === 0) {
      const methodSingle = ATTR_METHOD_RE.exec(attrArgs);
      if (methodSingle?.[1]) methods = [methodSingle[1]];
    }
    if (methods.length === 0) methods = ["get"]; // Symfony default.
    const nameMatch = ATTR_NAME_RE.exec(attrArgs);
    const routeName = nameMatch?.[1];
    // Buscar la signature del método en líneas siguientes (máximo 3).
    let methodName = "";
    for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
      const sig = /function\s+([a-zA-Z_][\w]*)\s*\(/.exec(lines[j] ?? "");
      if (sig?.[1]) {
        methodName = sig[1];
        break;
      }
    }
    const fullPath = (classPrefix + "/" + path).replace(/\/+/g, "/");
    for (const method of methods) {
      const mm = method.toLowerCase();
      if (!HTTP_METHODS.includes(mm)) continue;
      out.push({
        method: mm.toUpperCase(),
        uri: fullPath,
        rawUri: fullPath,
        sourceFile: relPath,
        lineNumber: i + 1,
        prefixChain: classPrefix ? [classPrefix] : [],
        displayName: routeName || methodName || `${mm.toUpperCase()} ${fullPath}`,
        ...(methodName ? { description: methodName } : {}),
      });
    }
  }
  return out;
}

function stripPhpComments(src: string): string {
  // Quita // ... y /* ... */ (no perfecto).
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------
// Validation spec provider
// ---------------------------------------------------------------------------

const ASSERT_MAP: Record<string, { type: IValidationSpec["type"]; format?: string }> = {
  NotBlank: { type: "string" },
  NotNull: { type: "string" },
  Length: { type: "string" },
  Email: { type: "string", format: "email" },
  Url: { type: "string", format: "url" },
  Uuid: { type: "string", format: "uuid" },
  Regex: { type: "string" },
  Choice: { type: "enum" },
  Range: { type: "integer" },
  GreaterThan: { type: "integer" },
  LessThan: { type: "integer" },
  Positive: { type: "integer" },
  PositiveOrZero: { type: "integer" },
  Negative: { type: "integer" },
  Date: { type: "date" },
  DateTime: { type: "datetime" },
  Time: { type: "string" },
  Ip: { type: "string" },
  Cidr: { type: "string" },
  Json: { type: "string" },
  IsTrue: { type: "boolean" },
  IsFalse: { type: "boolean" },
  Type: { type: "string" },
  Count: { type: "integer" },
};

const ATTR_ASSERT_RE = /#\[Assert\\([A-Z][\w]*)(?:\s*\(([^)]*)\))?\s*\]/gi;

export class SymfonyAttributesValidationProvider implements IValidationSpecProvider {
  readonly framework = "symfony" as const;

  async supports(_r: ParsedRoute, _m: IProjectMatch): Promise<boolean> {
    return _m.framework === "symfony" && Boolean(_r.sourceFile);
  }

  async resolve(route: ParsedRoute, match: IProjectMatch): Promise<{
    endpointKey: string;
    fields: IValidationSpec[];
  }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    if (!route.sourceFile) return { endpointKey, fields: [] };
    const abs = join(match.projectRoot, route.sourceFile);
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      return { endpointKey, fields: [] };
    }
    const text = stripPhpComments(raw);
    const lines = text.split("\n");

    // 1) Si la ruta viene de un atributo PHP, recoger assertions del
    //    método. El bloque empieza en route.lineNumber (atributo `#[Route]`
    //    puede estar en línea separada de los `#[Assert]` y de la signature)
    //    y termina en la `}` de cierre del método.
    const fields: IValidationSpec[] = [];
    if (route.lineNumber > 0) {
      const block = collectMethodBlockFromAttr(lines, route.lineNumber - 1);
      for (const cf of collectAssertsInBlock(block)) {
        fields.push(cf);
      }
    }
    // 2) Si la ruta viene de YAML controller ref, route.description es
    //    el nombre del método: localizar el method en el archivo.
    if (fields.length === 0 && route.description) {
      const methodName = route.description;
      const idx = lines.findIndex((l) =>
        new RegExp(`function\\s+${methodName}\\s*\\(`).test(l),
      );
      if (idx >= 0) {
        const block = collectMethodBlockFromAttr(lines, idx);
        for (const cf of collectAssertsInBlock(block)) {
          fields.push(cf);
        }
      }
    }
    return { endpointKey, fields };
  }
}

/**
 * Recoge el bloque del método empezando desde `fromInclude`. Esto cubre:
 *   - `#[Route(...)]` (Symfony controllers)
 *   - `#[Assert\NotBlank]` y otros constraints
 *   - la signature `public function createOrder(...)`
 *   - el cuerpo `{ ... }`
 *
 * Estrategia: recopila líneas desde `fromInclude` hasta encontrar la `}`
 * de cierre del método (depth 0). Las Asserts pueden estar ANTES del `{`
 * (en la signature) pero después del `#[Route]`, así que no basta con
 * contar llaves.
 */
function collectMethodBlockFromAttr(
  lines: string[],
  fromInclude: number,
): string[] {
  const out: string[] = [];
  let depth = 0;
  // Primero: encontrar la línea de signature `function name(` para
  // saber dónde EMPEZAR a contar llaves.
  let sigLine = -1;
  for (let i = fromInclude; i < Math.min(fromInclude + 15, lines.length); i++) {
    if (/function\s+[a-zA-Z_][\w]*\s*\(/.test(lines[i] ?? "")) {
      sigLine = i;
      break;
    }
  }
  // Si no hay signature en 15 líneas, recogemos hasta profundidad 0
  // ignorando signature faltante.
  const startCount = sigLine >= 0 ? sigLine : fromInclude;
  let started = false;
  for (let i = fromInclude; i < lines.length; i++) {
    const line = lines[i] ?? "";
    out.push(line);
    if (i < startCount) continue;
    if (!started) {
      // Buscar la primera `{` desde la signature.
      if (line.includes("{")) {
        started = true;
        depth += (line.match(/\{/g) ?? []).length;
        depth -= (line.match(/\}/g) ?? []).length;
      }
      continue;
    }
    depth += (line.match(/\{/g) ?? []).length;
    depth -= (line.match(/\}/g) ?? []).length;
    if (depth <= 0) break;
  }
  return out;
}

/**
 * Para cada `#[Assert\Xxx(...)]` en el bloque del método, identificar el
 * nombre del parámetro (línea inmediatamente posterior) y emitir un
 * `IValidationSpec`.
 *
 * Estructura típica:
 *   public function create(
 *     #[Assert\NotBlank] string $name,
 *     #[Assert\Email] string $email,
 *   ) { ... }
 */
function collectAssertsInBlock(block: string[]): IValidationSpec[] {
  const out: IValidationSpec[] = [];
  for (let i = 0; i < block.length; i++) {
    const line = block[i] ?? "";
    ATTR_ASSERT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ATTR_ASSERT_RE.exec(line)) !== null) {
      const annotation = m[1];
      const args = m[2] ?? "";
      const map = annotation ? ASSERT_MAP[annotation] : undefined;
      if (!map) continue;
      // Nombre del parámetro: línea actual + líneas siguientes (puede que
      // `#[Assert\X]` esté en línea separada del `string $name`).
      const tail = block.slice(i, i + 3).join(" ");
      const paramName = /\$([a-zA-Z_][\w]*)/.exec(tail);
      const name = paramName?.[1];
      if (!name) continue;
      // Required: a menos que la assertion sea NotNull/IsTrue/IsFalse con
      // `allowNull: true`. Simplificación: por defecto required.
      const required = !/allowNull\s*:\s*true/.test(args);
      const field: IValidationSpec = {
        fieldName: name,
        location: "body",
        type: map.type,
        required,
        ...(map.format ? { format: map.format } : {}),
      };
      // Choice: extraer enumValues de `choices: [a, b, c]`.
      if (annotation === "Choice") {
        const choices = /choices\s*:\s*\[([^\]]*)\]/i.exec(args);
        if (choices?.[1]) {
          field.enumValues = choices[1]
            .split(",")
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
            .filter(Boolean);
        }
      }
      // Length: extraer min/max.
      if (annotation === "Length") {
        const min = /min\s*:\s*(\d+)/i.exec(args);
        const max = /max\s*:\s*(\d+)/i.exec(args);
        if (min?.[1]) field.minLength = Number(min[1]);
        if (max?.[1]) field.maxLength = Number(max[1]);
      }
      // Range: extraer min/max.
      if (annotation === "Range") {
        const min = /min\s*:\s*(\d+)/i.exec(args);
        const max = /max\s*:\s*(\d+)/i.exec(args);
        if (min?.[1]) field.minimum = Number(min[1]);
        if (max?.[1]) field.maximum = Number(max[1]);
      }
      out.push(field);
    }
  }
  return out;
}
