
import { readFile, readdir } from "node:fs/promises";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { ownRegex } from "../../core/helpers/regex.helper.js";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import { join } from "node:path";
import { effectiveProjectRoot, rawProjectRoot } from "../../core/discovery/effective-project-root.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"];

async function isAspNetProject(projectRoot: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(projectRoot);
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".csproj")) continue;
    const p = join(projectRoot, entry);
    let raw: string;
    try {
      raw = await readFile(p, "utf8");
    } catch {
      continue;
    }
    return /AspNetCore/i.test(raw);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export class AspNetProjectScanner implements IProjectScanner {
  readonly framework = "aspnet" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const isAsp = await isAspNetProject(projectRoot);
    if (!isAsp) return emptyResult(0);
    return withEvidence(1, [{
      signal: ".csproj presente con Microsoft.AspNetCore",
      weight: 1,
      artifact: "*.csproj",
    }]);
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const artifacts: string[] = [];
    let entries: string[];
    try {
      entries = await readdir(projectRoot);
    } catch {
      return { framework: "aspnet", projectRoot, artifacts };
    }
    for (const entry of entries) {
      if (entry.endsWith(".csproj")) artifacts.push(entry);
    }
    return { framework: "aspnet", projectRoot, artifacts };
  }
}

// ---------------------------------------------------------------------------
// Route scanner
// ---------------------------------------------------------------------------

/**
 * Class attributes: `[Route("api/v1")]`, `[ApiController]`.
 */
const CLASS_ATTR_RE =
  /\[(Route|ApiController)\s*(\([^)]*\))?\]/g;

/**
 * Method attributes: `[HttpGet("users")]`, `[HttpPost]`, etc.
 */
const METHOD_ATTR_RE =
  /\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch|HttpHead|HttpOptions)\s*(\([^)]*\))?\]/g;

export class AspNetRouteScanner implements IRouteScanner {
  readonly framework = "aspnet" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "aspnet";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const out: ParsedRoute[] = [];
    const projectRoot = effectiveProjectRoot(match);
    // Search *.cs recursively.
    await walkCs(projectRoot, projectRoot, out);
    return { routes: out };
  }
}

async function walkCs(
  dir: string,
  projectRoot: string,
  out: ParsedRoute[],
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (entry.endsWith(".cs") && !entry.endsWith(".bak")) {
      const rel = full.startsWith(projectRoot)
        ? full.slice(projectRoot.length + 1).split("/").join("/")
        : full;
      out.push(...(await parseCsFile(full, rel)));
    } else if (!entry.includes(".") && entry !== "bin" && entry !== "obj") {
      await walkCs(full, projectRoot, out);
    }
  }
}

/**
 * Normalises the ASP.NET path to the collection's shape.
 *
 * Three transformations:
 *
 *   1. Path constraints: `{id:int}`, `{id:guid}`, `{id:minlength(2)}`
 *      → `{id}`. The constraint is server-side documentation; in the
 *      collection the token is what the user substitutes.
 *   2. `[controller]` / `[action]` → the controller/action name when it
 *      can be derived (`UsersController` → `users`). Before, the
 *      literal `[controller]` token ended up in the URL — which is
 *      exactly the kind of collection the user has to fix by hand.
 *   3. Any residual token with `:` inside braces is cleaned by rule 1.
 */
function normalizeAspNetPath(path: string, fallbackAction: string, controllerToken?: string): string {
  return path
    .replace(/\{(\w+):[^}]+\}/g, "{$1}")
    .replace(/\[controller\]/gi, controllerToken ?? deriveControllerToken(path) ?? "controller")
    .replace(/\[action\]/gi, fallbackAction)
    .replace(/\{(\w+):[^}]+\}/g, "{$1}");
}

/**
 * Derives the `[controller]` token by looking at the source path itself.
 *
 * ASP.NET resolves it to the controller name without the `Controller`
 * suffix in kebab/lower. We don't have the class name in this function
 * (processing happens line by line), so the caller passes it as a
 * fallback; here we only clean whatever is in the path itself.
 */
function deriveControllerToken(path: string): string | null {
  // `[Route("[controller]/[action]")]` doesn't carry the name: without
  // the class declaration it cannot be derived. Return null and let
  // the caller decide on its fallback.
  const m = /\[controller\]\s*\/?\s*\[?([\w-]+)\]?/.exec(path);
  return m?.[1] ?? null;
}

async function parseCsFile(
  absPath: string,
  relPath: string,
): Promise<ParsedRoute[]> {
  const out: ParsedRoute[] = [];
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch {
    return [];
  }
  const text = stripCsComments(raw);
  const lines = text.split("\n");

  // 0) Minimal APIs. This is the default form since .NET 6 and does
  //    not use controllers, so it's detected separately and can
  //    coexist with them in the same project.
  out.push(...parseMinimalApis(lines, relPath));

  // 1) Detect controller prefix.
  let classPrefix = "";
  let classStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    let m: RegExpExecArray | null;
    const classAttrRe = ownRegex(CLASS_ATTR_RE);
    while ((m = classAttrRe.exec(line)) !== null) {
      const decorator = m[1] ?? "";
      if (decorator === "Route") {
        const args = m[2] ?? "";
        classPrefix = extractPath(args);
        classStart = i;
        break;
      }
    }
    if (classStart >= 0) break;
  }
  if (classStart < 0) return out;

  let controllerToken: string | undefined;
  for (let i = classStart; i < lines.length; i++) {
    const classMatch = /\bclass\s+([A-Za-z_][\w]*)/.exec(lines[i] ?? "");
    if (!classMatch?.[1]) continue;
    controllerToken = classMatch[1].replace(/Controller$/i, "").toLowerCase();
    break;
  }


  // 2) Look for method attributes.
  for (let i = classStart + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    let m: RegExpExecArray | null;
    const methodAttrRe = ownRegex(METHOD_ATTR_RE);
    while ((m = methodAttrRe.exec(line)) !== null) {
      const decorator = m[1] ?? "";
      const args = m[2] ?? "";
      const subPath = extractPath(args);
      const fullPath = joinRoutePath("/", classPrefix, subPath);
      const method = decorator.replace("Http", "").toLowerCase();
      if (!HTTP_METHODS.includes(method)) continue;
      // Look for the method signature.
      let methodName = "";
      for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
        const sig = /\b(?:public|private|protected|internal)?\s*(?:async\s+)?(?:Task<[^>]+>\s+)?([a-zA-Z_][\w]*)\s*\(/.exec(lines[j] ?? "");
        if (sig?.[1]) {
          methodName = sig[1];
          break;
        }
      }
      out.push({
        method: method.toUpperCase(),
        uri: normalizeAspNetPath(fullPath, methodName || "index", controllerToken),
        rawUri: fullPath,
        sourceFile: relPath,
        lineNumber: i + 1,
        prefixChain: classPrefix ? [classPrefix] : [],
        displayName: methodName || `${method.toUpperCase()} ${fullPath}`,
        ...(methodName ? { description: methodName } : {}),
      });
    }
  }
  return out;
}

/**
 * `app.MapGet("/users", handler)` — .NET 6+ minimal APIs.
 *
 * Captures: 1 = variable (`app`, `users`…), 2 = verb, 3 = path.
 *
 * x00036 S1: incluye también `MapHead` y `MapOptions` (HEAD para
 * health-checks, OPTIONS para preflight CORS). Ambos verbos ya están
 * aceptados por `HTTP_METHODS` para el camino de controllers
 * (`[HttpHead]` / `[HttpOptions]`).
 */
const MINIMAL_API_RE =
  /\b([a-zA-Z_][\w]*)\s*\.\s*Map(Get|Post|Put|Delete|Patch|Head|Options)\s*\(\s*(["'][^"']*["'])/g;

/**
 * `var group = app.MapGroup("/api/users");` — group prefix.
 * Captures: 1 = group variable, 2 = prefix.
 */
const MAP_GROUP_RE =
  /\b(?:var|[A-Za-z_][\w<>,\s]*?)\s+([a-zA-Z_][\w]*)\s*=\s*[a-zA-Z_][\w]*\s*\.\s*MapGroup\s*\(\s*["']([^"']*)["']/g;

/**
 * Extracts the routes declared with minimal APIs.
 *
 * It's the idiomatic form in .NET 6+ and nothing covered it: a project
 * using them (every `Program.cs` generated by `dotnet new webapi` since
 * .NET 6) used to produce an empty collection.
 */
function parseMinimalApis(lines: string[], relPath: string): ParsedRoute[] {
  const out: ParsedRoute[] = [];
  const text = lines.join("\n");

  // Prefixes of the groups declared in the file.
  const groupPrefix = new Map<string, string>();
  const groupRe = new RegExp(MAP_GROUP_RE.source, "g");
  let groupMatch: RegExpExecArray | null;
  while ((groupMatch = groupRe.exec(text)) !== null) {
    const variable = groupMatch[1];
    const prefix = groupMatch[2];
    if (variable && prefix) groupPrefix.set(variable, prefix);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const re = new RegExp(MINIMAL_API_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const variable = m[1] ?? "";
      const method = (m[2] ?? "").toLowerCase();
      const path = (m[3] ?? "").replace(/^["']|["']$/g, "");
      if (!HTTP_METHODS.includes(method)) continue;

      const prefix = groupPrefix.get(variable) ?? "";
      const fullPath = joinRoutePath("/", prefix, path);
      out.push({
        method: method.toUpperCase(),
        uri: normalizeAspNetPath(fullPath, "index"),
        rawUri: fullPath,
        sourceFile: relPath,
        lineNumber: i + 1,
        prefixChain: prefix ? [prefix] : [],
        displayName: `${method.toUpperCase()} ${fullPath}`,
      });
    }
  }
  return out;
}

function extractPath(args: string): string {
  const m = /["']([^"']+)["']/.exec(args);
  return m?.[1] ?? "";
}

function stripCsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------
// Validation spec provider (no-op; bodies via inference)
// ---------------------------------------------------------------------------

export class AspNetDataAnnotationsProvider implements IValidationSpecProvider {
  readonly framework = "aspnet" as const;

  async supports(
    route: ParsedRoute,
    match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<boolean> {
    if (match.framework !== "aspnet") return false;
    return route.sourceFile !== undefined;
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<{ endpointKey: string; fields: IValidationSpec[] }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    if (!route.sourceFile) return { endpointKey, fields: [] };
    // GET and DELETE don't carry a body; their parameters already come from the URI.
    if (route.method === "GET" || route.method === "DELETE") {
      return { endpointKey, fields: [] };
    }
    const abs = join(rawProjectRoot(match), route.sourceFile);
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      return { endpointKey, fields: [] };
    }
    const dtoType = findDtoTypeForRoute(raw, route);
    if (!dtoType) return { endpointKey, fields: [] };

    let fields = parseCsDto(raw, dtoType);
    if (fields.length === 0) {
      fields = await findDtoInProject(effectiveProjectRoot(match), dtoType, route.uri);
    }
    return { endpointKey, fields };
  }
}

/** Signatures from which the body type can be extracted. */
const BODY_TYPE_PATTERNS: ReadonlyArray<RegExp> = [
  // Controller: `public IActionResult Create([FromBody] CreateUserRequest body)`
  /\[FromBody\]\s+([A-Z]\w*)\s+\w+/,
  // Minimal API: `MapPost("/", (CreateProductRequest body) => …)`
  /Map(?:Post|Put|Patch)\s*\([^)]*?\(\s*(?:\[FromBody\]\s*)?([A-Z]\w*)\s+\w+/,
  // Minimal API with a route param first: `(int id, CreateProductRequest body)`
  /Map(?:Post|Put|Patch)\s*\([^)]*?,\s*([A-Z]\w*)\s+\w+\s*\)\s*=>/,
  // Controller without attribute: `public IActionResult Create(CreateUserRequest body)`
  /\b(?:public|internal)\s+(?:async\s+)?[\w<>\[\]]+\s+\w+\s*\(\s*([A-Z]\w*)\s+\w+/,
];

/** Types that are never are a body DTO. */
const NOT_A_DTO = new Set([
  "Task", "IActionResult", "ActionResult", "String", "Int32", "Guid",
  "Results", "IResult", "HttpContext", "CancellationToken",
]);

/**
 * DTO type of the body for THIS route.
 *
 * Searched in the window of lines starting at the route declaration,
 * not across the whole file: the previous version grabbed the first
 * `[FromBody]` of the file, so a controller with several POSTs would
 * give all of them the first POST's body.
 *
 * Covers all four forms: `[FromBody]` in controller, typed parameter
 * of a minimal-API lambda (with and without a route param before it),
 * and action signature without attribute.
 */
function findDtoTypeForRoute(raw: string, route: ParsedRoute): string | null {
  const lines = stripCsComments(raw).split("\n");
  const start = Math.max(0, route.lineNumber - 1);
  const window = lines.slice(start, start + windowLength(lines, start)).join("\n");

  for (const pattern of BODY_TYPE_PATTERNS) {
    const type = pattern.exec(window)?.[1];
    if (type && !NOT_A_DTO.has(type)) return type;
  }
  return null;
}

/** Another route declaration: the end of the current window. */
const NEXT_ROUTE_RE = /\[Http(?:Get|Post|Put|Delete|Patch)|\.\s*Map(?:Get|Post|Put|Delete|Patch)\s*\(/;

/**
 * How many lines to look at from the route declaration.
 *
 * Stops as soon as the NEXT declaration appears: without that cut, an
 * endpoint without a body would steal the DTO of the endpoint below it
 * (in the fixture, `PATCH /orders/{id}/status` ended up with the
 * fields of the order-creation DTO).
 */
function windowLength(lines: ReadonlyArray<string>, start: number): number {
  const MAX = 6;
  for (let offset = 1; offset < MAX; offset++) {
    const line = lines[start + offset];
    if (line === undefined) return offset;
    if (NEXT_ROUTE_RE.test(line)) return offset;
  }
  return MAX;
}

/**
 * Parses a C# class from the file and extracts properties with Data Annotations.
 */
function parseCsDto(raw: string, dtoType: string): IValidationSpec[] {
  const out: IValidationSpec[] = [];
  const classRe = new RegExp(`class\\s+${dtoType}\\b[^{]*\\{`, "g");
  const classMatch = classRe.exec(raw);
  if (!classMatch) return out;
  const start = classMatch.index + classMatch[0].length;
  let depth = 1;
  let end = start;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") depth--;
    if (depth === 0) { end = i; break; }
  }
  const body = raw.slice(start, end);
  // Capture property with annotations:
  //   [Required]
  //   [StringLength(100, MinimumLength = 1)]
  //   public string Name { get; set; }
  const propRe = /((?:\[[^\]]+\]\s*)*)\s*(?:public|private|protected|internal)?\s*([\w<>?,\s]+?)\s+(\w+)\s*\{\s*(?:get|set)/g;
  let m: RegExpExecArray | null;
  while ((m = propRe.exec(body)) !== null) {
    const annotations = m[1] ?? "";
    const propType = (m[2] ?? "").trim();
    const fieldName = m[3] ?? "";
    const required = /\[Required\]/i.test(annotations);
    const isEmail = /\[EmailAddress\]/i.test(annotations);
    const stringLen = /\[StringLength\s*\(\s*(\d+)(?:\s*,\s*MinimumLength\s*=\s*(\d+))?\s*\)\]/i.exec(annotations);
    const range = /\[Range\s*\(\s*(\d+)\s*,\s*(\d+|int\.MaxValue)\s*\)\]/i.exec(annotations);
    const regex = /\[RegularExpression\s*\(\s*"([^"]+)"\s*\)\]/i.exec(annotations);
    const spec: IValidationSpec = {
      fieldName,
      location: "body",
      type: inferCsFieldType(propType, isEmail),
      required,
    };
    if (isEmail) spec.format = "email";
    if (stringLen) {
      spec.maxLength = Number(stringLen[1]);
      if (stringLen[2]) spec.minLength = Number(stringLen[2]);
    }
    if (range) {
      spec.minimum = Number(range[1]);
      if (range[2] && range[2] !== "int.MaxValue") spec.maximum = Number(range[2]);
    }
    if (regex?.[1] !== undefined) {
      const vals = regex[1].replace(/^\^?\(|\)\$?$/g, "").split("|").map((s) => s.trim()).filter(Boolean);
      if (vals.length > 1) {
        spec.enumValues = vals;
        spec.type = "enum";
      }
    }
    out.push(spec);
  }
  return out;
}

function inferCsFieldType(csType: string, isEmail: boolean): IValidationSpec["type"] {
  if (isEmail) return "string";
  if (/^(int|long|short|byte|Int16|Int32|Int64)$/.test(csType)) return "integer";
  if (/^(double|float|decimal|Double|Single)$/.test(csType)) return "number";
  if (/^(bool|boolean|Boolean)$/.test(csType)) return "boolean";
  if (/DateTime/.test(csType)) return "datetime";
  if (/^(List|Collection|IEnumerable|IList|HashSet|Set)</.test(csType)) return "array";
  return "string";
}

async function findDtoInProject(
  projectRoot: string,
  dtoType: string,
  uri?: string,
): Promise<IValidationSpec[]> {
  const csFiles: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch { return; }
    for (const e of entries) {
      const full = join(dir, e);
      if (e.endsWith(".cs")) csFiles.push(full);
      else if (!e.includes(".") && !e.endsWith(".csproj")) await walk(full);
    }
  }
  await walk(projectRoot);
  const uriWords = (uri ?? "")
    .split("/")
    .filter((w) => w && !w.startsWith("{{") && !w.startsWith(":"))
    .map((w) => w.toLowerCase().replace(/s$/, ""));
  const ranked = csFiles
    .map((f) => ({
      f,
      score: uriWords.reduce((acc, w) => (w && f.toLowerCase().includes(w) ? acc + 1 : acc), 0),
    }))
    .sort((a, b) => b.score - a.score);
  for (const { f } of ranked) {
    let raw: string;
    try { raw = await readFile(f, "utf8"); } catch { continue; }
    const fields = parseCsDto(raw, dtoType);
    if (fields.length > 0) return fields;
  }
  return [];
}
