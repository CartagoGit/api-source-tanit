
import { readFile, readdir } from "node:fs/promises";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import { join } from "node:path";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../core/contracts/scanner.interface.js";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"];

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

  async detect(projectRoot: string): Promise<number> {
    const isAsp = await isAspNetProject(projectRoot);
    if (!isAsp) return 0;
    return 1;
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
 * Atributos de clase: `[Route("api/v1")]`, `[ApiController]`.
 */
const CLASS_ATTR_RE =
  /\[(Route|ApiController)\s*(\([^)]*\))?\]/g;

/**
 * Atributos de método: `[HttpGet("users")]`, `[HttpPost]`, etc.
 */
const METHOD_ATTR_RE =
  /\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch|HttpHead|HttpOptions)\s*(\([^)]*\))?\]/g;

export class AspNetRouteScanner implements IRouteScanner {
  readonly framework = "aspnet" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "aspnet";
  }

  async scan(match: IProjectMatch): Promise<ParsedRoute[]> {
    const out: ParsedRoute[] = [];
    const projectRoot = match.projectRoot;
    // Buscar *.cs recursivamente.
    await walkCs(projectRoot, projectRoot, out);
    return out;
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

  // 0) Minimal APIs. Es la forma por defecto desde .NET 6 y no usa
  //    controladores, así que se detecta aparte y puede convivir con
  //    ellos en el mismo proyecto.
  out.push(...parseMinimalApis(lines, relPath));

  // 1) Detectar prefijo del controller.
  let classPrefix = "";
  let classStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    CLASS_ATTR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CLASS_ATTR_RE.exec(line)) !== null) {
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


  // 2) Buscar method attributes.
  for (let i = classStart + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    METHOD_ATTR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = METHOD_ATTR_RE.exec(line)) !== null) {
      const decorator = m[1] ?? "";
      const args = m[2] ?? "";
      const subPath = extractPath(args);
      const fullPath = joinRoutePath("/", classPrefix, subPath);
      const method = decorator.replace("Http", "").toLowerCase();
      if (!HTTP_METHODS.includes(method)) continue;
      // Buscar signature del método.
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
        uri: fullPath,
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
 * `app.MapGet("/users", handler)` — minimal APIs de .NET 6+.
 *
 * Captura: 1 = variable (`app`, `users`…), 2 = verbo, 3 = ruta.
 */
const MINIMAL_API_RE =
  /\b([a-zA-Z_][\w]*)\s*\.\s*Map(Get|Post|Put|Delete|Patch)\s*\(\s*(["'][^"']*["'])/g;

/**
 * `var grupo = app.MapGroup("/api/users");` — prefijo de un grupo.
 * Captura: 1 = variable del grupo, 2 = prefijo.
 */
const MAP_GROUP_RE =
  /\b(?:var|[A-Za-z_][\w<>,\s]*?)\s+([a-zA-Z_][\w]*)\s*=\s*[a-zA-Z_][\w]*\s*\.\s*MapGroup\s*\(\s*["']([^"']*)["']/g;

/**
 * Extrae las rutas declaradas con minimal APIs.
 *
 * Es lo idiomático en .NET 6+ y no lo cubría nada: un proyecto que las
 * usara (todo `Program.cs` generado por `dotnet new webapi` desde .NET 6)
 * producía una colección vacía.
 */
function parseMinimalApis(lines: string[], relPath: string): ParsedRoute[] {
  const out: ParsedRoute[] = [];
  const text = lines.join("\n");

  // Prefijos de los grupos declarados en el fichero.
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
        uri: fullPath,
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

  async supports(route: ParsedRoute, match: IProjectMatch): Promise<boolean> {
    if (match.framework !== "aspnet") return false;
    return route.sourceFile !== undefined;
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
  ): Promise<{ endpointKey: string; fields: IValidationSpec[] }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    if (!route.sourceFile) return { endpointKey, fields: [] };
    // GET y DELETE no llevan body; sus parámetros ya salen de la URI.
    if (route.method === "GET" || route.method === "DELETE") {
      return { endpointKey, fields: [] };
    }
    const abs = join(match.projectRoot, route.sourceFile);
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
      fields = await findDtoInProject(match.projectRoot, dtoType, route.uri);
    }
    return { endpointKey, fields };
  }
}

/** Firmas de las que se puede sacar el tipo del body. */
const BODY_TYPE_PATTERNS: ReadonlyArray<RegExp> = [
  // Controlador: `public IActionResult Create([FromBody] CreateUserRequest body)`
  /\[FromBody\]\s+([A-Z]\w*)\s+\w+/,
  // Minimal API: `MapPost("/", (CreateProductRequest body) => …)`
  /Map(?:Post|Put|Patch)\s*\([^)]*?\(\s*(?:\[FromBody\]\s*)?([A-Z]\w*)\s+\w+/,
  // Minimal API con param de ruta primero: `(int id, CreateProductRequest body)`
  /Map(?:Post|Put|Patch)\s*\([^)]*?,\s*([A-Z]\w*)\s+\w+\s*\)\s*=>/,
  // Controlador sin atributo: `public IActionResult Create(CreateUserRequest body)`
  /\b(?:public|internal)\s+(?:async\s+)?[\w<>\[\]]+\s+\w+\s*\(\s*([A-Z]\w*)\s+\w+/,
];

/** Tipos que nunca son un DTO de body. */
const NOT_A_DTO = new Set([
  "Task", "IActionResult", "ActionResult", "String", "Int32", "Guid",
  "Results", "IResult", "HttpContext", "CancellationToken",
]);

/**
 * Tipo del DTO del body para ESTA ruta.
 *
 * Se busca en la ventana de líneas que arranca en la declaración de la
 * ruta, no en todo el fichero: la versión anterior cogía el primer
 * `[FromBody]` del archivo, así que en un controlador con varios POST
 * todos recibían el body del primero.
 *
 * Cubre las cuatro formas: `[FromBody]` en controlador, parámetro tipado
 * de un lambda de minimal API (con y sin param de ruta delante), y firma
 * de acción sin atributo.
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

/** Otra declaración de ruta: el final de la ventana de la actual. */
const NEXT_ROUTE_RE = /\[Http(?:Get|Post|Put|Delete|Patch)|\.\s*Map(?:Get|Post|Put|Delete|Patch)\s*\(/;

/**
 * Cuántas líneas mirar desde la declaración de la ruta.
 *
 * Se corta en cuanto aparece la SIGUIENTE declaración: sin ese corte, un
 * endpoint sin body se llevaba el DTO del endpoint de debajo (en el
 * fixture, `PATCH /orders/{id}/status` acababa con los campos del DTO de
 * creación de pedidos).
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
 * Parsea una class C# del archivo y extrae properties con Data Annotations.
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
  // Capturar property con annotations:
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
    if (regex) {
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
