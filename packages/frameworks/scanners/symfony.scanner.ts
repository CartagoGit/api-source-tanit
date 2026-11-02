/**
 * `SymfonyScanner` — implementation of `IProjectScanner` + `IRouteScanner`
 * for Symfony projects (5.x, 6.x, 7.x).
 *
 * Detection:
 *   - `composer.json` with `require` containing `symfony/framework-bundle`
 *     or `symfony/routing`.
 *   - `bin/console` (heuristic) or `app/AppKernel.php` (legacy 4.x).
 *
 * Route parsing:
 *   - YAML: `config/routes.yaml`, `config/routes/*.yaml` (not nested).
 *   - YAML / `*.php` (PHP routes): best-effort regex.
 *   - PHP attributes: `Route('/users', methods: ['GET'])` in
 *     `src/Controller/`.
 *
 * Validation:
 *   - `SymfonyAttributesValidationProvider` extracts Doctrine
 *     NotBlank, Email, Length, Choice, Range, etc. constraints from
 *     the controller method by inspecting typed parameters.
 *
 * Limitations:
 *   - Only YAML and PHP routes (not complex PHP routes like RouterInterface).
 *   - Does not resolve `AsEventListener`, `AsCommand`, etc.
 *   - Constraints must be in the method (not in a separate Entity).
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { ownRegex } from "../../core/helpers/regex.helper.js";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isRecord, parseJson } from "../../core/helpers/parse-json.helper.js";
import { effectiveProjectRoot, rawProjectRoot } from "../../core/discovery/effective-project-root.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";
import { parseYamlLite } from "./openapi.scanner.js";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"];
const SYMFONY_REQUIRE_KEYS = ["symfony/framework-bundle", "symfony/routing"];

/**
 * Reads composer.json and returns true if any of the SYMFONY_REQUIRE_KEYS
 * is in `require` or `require-dev`.
 */
async function isSymfonyProject(projectRoot: string): Promise<boolean> {
  const composerPath = join(projectRoot, "composer.json");
  if (!existsSync(composerPath)) return false;
  let raw: string;
  try {
    raw = await readFile(composerPath, "utf8");
  } catch {
    return false;
  }
  const parsed = parseJson(raw);
  if (!parsed.ok || !isRecord(parsed.value)) return false;
  const req = (parsed.value["require"] ?? {}) as Record<string, string>;
  const reqDev = (parsed.value["require-dev"] ?? {}) as Record<string, string>;
  for (const key of SYMFONY_REQUIRE_KEYS) {
    if (typeof req[key] === "string" || typeof reqDev[key] === "string") {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export class SymfonyProjectScanner implements IProjectScanner {
  readonly framework = "symfony" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const detected = await isSymfonyProject(projectRoot);
    if (!detected) return emptyResult(0);
    const hasBinConsole = existsSync(join(projectRoot, "bin", "console"));
    const hasConfigRoutes = existsSync(join(projectRoot, "config", "routes.yaml"));
    const hasSrcController = existsSync(join(projectRoot, "src", "Controller"));
    const signals: Array<{ signal: string; weight: number; artifact?: string }> = [
      { signal: "composer.json declara symfony/framework-bundle o symfony/routing", weight: 0.6, artifact: "composer.json" },
    ];
    if (hasBinConsole) signals.push({ signal: "bin/console presente", weight: 0.3, artifact: "bin/console" });
    if (hasConfigRoutes) signals.push({ signal: "config/routes.yaml presente", weight: 0.1, artifact: "config/routes.yaml" });
    if (hasSrcController) signals.push({ signal: "src/Controller presente", weight: 0.1, artifact: "src/Controller/" });
    return withEvidence(Math.min(signals.reduce((a, s) => a + s.weight, 0), 1), signals);
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

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const out: ParsedRoute[] = [];
    const projectRoot = effectiveProjectRoot(match);
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
    // 2) PHP attributes in src/Controller/**.
    const controllerDir = join(projectRoot, "src", "Controller");
    if (existsSync(controllerDir)) {
      out.push(...(await parseControllerAttributes(controllerDir, projectRoot)));
    }
    // The same endpoint can arrive via two routes: declared in YAML
    // and also as `#[Route]` in the controller (or via `resource:`
    // that already points to the same file). Symfony registers it
    // only once.
    return { routes: dedupeRoutes(out) };
  }
}

/**
 * Collapses equivalent routes (same method and same URI except trailing
 * slash) keeping the most informative one: the one coming from
 * `#[Route]` in the controller carries `lineNumber` and the method
 * name, which is what the validation provider needs to read the
 * `#[Assert\...]`.
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
  const result = [...byKey.values()];
  // Second pass (F-009): the same physical endpoint can arrive twice
  // with a different URI — via `resource:` from the YAML with the
  // import's prefix (`/api/widgets`) and via the src/Controller walk,
  // where the class adds its own prefix (`/widgets`). Physical identity
  // is the trio (source file, attribute line, method): sharing all
  // three means both copies read the same `#[Route]` from the same
  // controller. Symfony registers only one — here the longer URI
  // wins, which is the one with the import's prefix.
  //
  // Only attribute routes (lineNumber > 0): direct YAML entries share
  // file and lineNumber 0 among themselves, and they are not the
  // same route.
  const identidad = (r: ParsedRoute): string =>
    `${r.method} ${r.sourceFile}:${r.lineNumber}`;
  const mejorPorIdentidad = new Map<string, ParsedRoute>();
  const conDuplicado = new Set<string>();
  for (const r of result) {
    if (r.lineNumber <= 0) continue;
    const id = identidad(r);
    const actual = mejorPorIdentidad.get(id);
    if (!actual) {
      mejorPorIdentidad.set(id, r);
      continue;
    }
    conDuplicado.add(id);
    if (r.uri.length > actual.uri.length) {
      mejorPorIdentidad.set(id, r);
    }
  }
  if (conDuplicado.size === 0) return result;
  return result.filter(
    (r) => r.lineNumber <= 0 || !conDuplicado.has(identidad(r)) || mejorPorIdentidad.get(identidad(r)) === r,
  );
}

/** Strips the trailing slash (`/users/` and `/users` are the same route). */
function normalizeSymfonyUri(uri: string): string {
  const collapsed = uri.replace(/\/+/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/$/, "") : collapsed;
}

/** Higher = more usable information downstream. */
function scoreRoute(route: ParsedRoute): number {
  return (route.lineNumber > 0 ? 2 : 0) + (route.description ? 1 : 0);
}

/**
 * Parses a Symfony YAML routes file. Supports:
 *   - direct routing:
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
  let parsed: unknown;
  try {
    parsed = parseYamlLite(raw);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const out: ParsedRoute[] = [];
  for (const [name, body] of Object.entries(parsed)) {
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
          ...(controller?.includes("\\")
            ? { controllerClass: controller.split("::")[0] }
            : {}),
          ...(controller?.includes("::")
            ? { actionName: controller.split("::").pop() ?? "" }
            : {}),
        });
      }
    } else if (resource && /\.\/.*Controller.*\.php/.test(resource)) {
      // Points at a controller: parse its attributes.
      const relativeController = resolve(dirname(absPath), resource);
      const rootController = resolve(projectRoot, resource);
      const ctrlAbs = existsSync(relativeController) ? relativeController : rootController;
      // NOTE: the third argument is the projectRoot, not the YAML source.
      // Passing `relPath` here left `sourceFile` as an absolute path and
      // the validation provider could never find the controller.
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
 * Project-relative path in POSIX format.
 *
 * Both sides are resolved to absolute before comparing: the
 * projectRoot can arrive as `./something` and a textual comparison
 * with `startsWith` left `sourceFile` absolute, which made the
 * validation provider build `join(projectRoot, sourceFile)` and never
 * find the file.
 */
function toProjectRelative(absPath: string, projectRoot: string): string {
  return relative(resolve(projectRoot), resolve(absPath)).split(sep).join("/");
}

/**
 * Walks src/Controller recursively and extracts `#[Route(...)]` from
 * each public method.
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

  // 1) Detect `#[Route('/prefix')] class Name { ... }` for class prefix.
  //    In Symfony `#[Route(...)]` comes BEFORE `class`. We look for
  //    `class <Name>` and then a `#[Route]` in the 3 previous lines.
  let classPrefix = prefix;
  let classRouteIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/class\s+\w+/.test(line)) {
      // Look for `#[Route(...)]` in the 3 previous lines.
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const m = ownRegex(ATTR_ROUTE_RE).exec(lines[j] ?? "");
        if (m) {
          const args = m[1] ?? "";
          const pathMatch = /^\s*['"]([^'"]*)['"]/.exec(args);
          const classPath = pathMatch?.[1] ?? "";
          // Only apply as class prefix if it does NOT have methods.
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

  // 2) Iterate `#[Route(...)]` in methods (after classRouteIdx).
  //    This strategy replaces the previous convention: it now accepts
  //    `#[Route('/path', methods: ['POST'])]` in methods.
  const startIter = classRouteIdx >= 0 ? classRouteIdx + 1 : 0;
  for (let i = startIter; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = ownRegex(ATTR_ROUTE_RE).exec(line);
    if (!m) continue;
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
    // Look for the method signature in the next lines (max 3).
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

  async supports(
    _r: ParsedRoute,
    _m: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<boolean> {
    return _m.framework === "symfony" && Boolean(_r.sourceFile);
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<{
    endpointKey: string;
    fields: IValidationSpec[];
  }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    if (!route.sourceFile) return { endpointKey, fields: [] };
    const controllerPath = route.controllerClass
      ? await findControllerFile(effectiveProjectRoot(match), route.controllerClass)
      : null;
    const abs = controllerPath ?? join(rawProjectRoot(match), route.sourceFile);
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      return { endpointKey, fields: [] };
    }
    const text = stripPhpComments(raw);
    const lines = text.split("\n");

    // 1) If the route comes from a PHP attribute, collect assertions
    //    from the method. The block starts at route.lineNumber (the
    //    `#[Route]` attribute can be on a line separate from the
    //    `#[Assert]`s and the signature) and ends at the closing `}`
    //    of the method.
    const fields: IValidationSpec[] = [];
    if (route.lineNumber > 0) {
      const block = collectMethodBlockFromAttr(lines, route.lineNumber - 1);
      for (const cf of collectAssertsInBlock(block)) {
        fields.push(cf);
      }
    }
    // 2) If the route comes from a YAML controller ref, locate the action.
    if (fields.length === 0 && (route.actionName || route.description)) {
      const methodName = route.actionName || route.description || "";
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

async function findControllerFile(
  projectRoot: string,
  controllerClass: string,
): Promise<string | null> {
  const className = controllerClass.split("\\").pop();
  if (!className) return null;
  const controllerRoot = join(projectRoot, "src", "Controller");
  if (!existsSync(controllerRoot)) return null;
  const visit = async (dir: string): Promise<string | null> => {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return null;
    }
    for (const entry of entries) {
      const child = join(dir, entry);
      if (entry === `${className}.php`) return child;
      if (!entry.includes(".")) {
        const found = await visit(child);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(controllerRoot);
}

/**
 * Collects the method block starting from `fromInclude`. This covers:
 *   - `#[Route(...)]` (Symfony controllers)
 *   - `#[Assert\NotBlank]` and other constraints
 *   - the signature `public function createOrder(...)`
 *   - the body `{ ... }`
 *
 * Strategy: collect lines from `fromInclude` until we find the
 * closing `}` of the method (depth 0). The Asserts can be BEFORE the
 * `{` (in the signature) but after the `#[Route]`, so just counting
 * braces isn't enough.
 */
function collectMethodBlockFromAttr(
  lines: string[],
  fromInclude: number,
): string[] {
  const out: string[] = [];
  let depth = 0;
  // First: find the signature line `function name(` to know where to
  // START counting braces.
  let sigLine = -1;
  for (let i = fromInclude; i < Math.min(fromInclude + 15, lines.length); i++) {
    if (/function\s+[a-zA-Z_][\w]*\s*\(/.test(lines[i] ?? "")) {
      sigLine = i;
      break;
    }
  }
  // If there's no signature within 15 lines, we collect up to depth 0
  // ignoring the missing signature.
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
 * For each `#[Assert\Xxx(...)]` in the method block, identifies the
 * parameter name (next line) and emits an `IValidationSpec`.
 *
 * Typical structure:
 *   public function create(
 *     #[Assert\NotBlank] string $name,
 *     #[Assert\Email] string $email,
 *   ) { ... }
 */
function collectAssertsInBlock(block: string[]): IValidationSpec[] {
  const out: IValidationSpec[] = [];
  for (let i = 0; i < block.length; i++) {
    const line = block[i] ?? "";
    let m: RegExpExecArray | null;
    const attrAssertRe = ownRegex(ATTR_ASSERT_RE);
    while ((m = attrAssertRe.exec(line)) !== null) {
      const annotation = m[1];
      const args = m[2] ?? "";
      const map = annotation ? ASSERT_MAP[annotation] : undefined;
      if (!map) continue;
      // Parameter name: current line + next lines (the `#[Assert\X]` may
      // be on a line separate from the `string $name`).
      const tail = block.slice(i, i + 3).join(" ");
      const paramName = /\$([a-zA-Z_][\w]*)/.exec(tail);
      const name = paramName?.[1];
      if (!name) continue;
      // Required: unless the assertion is NotNull/IsTrue/IsFalse with
      // `allowNull: true`. Simplification: required by default.
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
