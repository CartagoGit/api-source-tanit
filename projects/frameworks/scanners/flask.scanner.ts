/**
 * `FlaskScanner` — implementación de `IProjectScanner` + `IRouteScanner`
 * para Flask (Python minimal web framework).
 *
 * Detección:
 *   - `requirements.txt` o `pyproject.toml` con `flask`.
 *
 * Parsing:
 *   - Decoradores `@app.route('/path', methods=['GET', 'POST'])` en views.py.
 *   - Soporta Blueprints: `@bp.route(...)` con `bp = Blueprint('users', __name__)`.
 *   - Soporta `app.add_url_rule(...)` (regex).
 *
 * Validation:
 *   - `FlaskValidationProvider`: extrae los campos de los schemas
 *     Marshmallow (`fields.Str(required=True)`) y de los modelos
 *     Pydantic de `flask-pydantic`.
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import { collectFilesFrom } from "../../core/helpers/fs-walk.helper.js";
import {
  marshmallowSchemaToSpecs,
  parseMarshmallowSchemas,
} from "../parsers/marshmallow-schema.helper.js";
import {
  parsePydanticModels,
  pydanticModelToSpecs,
} from "../parsers/pydantic-schema.helper.js";
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

async function isFlaskProject(projectRoot: string): Promise<boolean> {
  for (const file of ["requirements.txt", "pyproject.toml", "Pipfile"]) {
    const p = join(projectRoot, file);
    if (!existsSync(p)) continue;
    let raw: string;
    try {
      raw = await readFile(p, "utf8");
    } catch {
      continue;
    }
    // Match: `flask>=3.0`, `flask = "^3.0"`, `["flask"]`, `name = "flask"`,
    // `flask\nflask-cors`, etc.
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      // requirements.txt: `flask`, `flask>=3.0`, `flask[cors]`.
      if (/^flask(\[.*?\])?\s*([<>=!~].*)?$/i.test(trimmed)) return true;
      // pyproject.toml/Pipfile: `flask = "^3.0"`, `"flask"`, `'flask'`.
      if (/^flask\s*=\s*["'][^"']*["']/i.test(trimmed)) return true;
      if (/["']flask["']/i.test(trimmed)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export class FlaskProjectScanner implements IProjectScanner {
  readonly framework = "flask" as const;

  async detect(projectRoot: string): Promise<number> {
    const isFlask = await isFlaskProject(projectRoot);
    if (!isFlask) return 0;
    const hasApp = existsSync(join(projectRoot, "app.py"));
    const hasWsgi = existsSync(join(projectRoot, "wsgi.py"));
    if (hasApp || hasWsgi) return 1;
    return 0.7;
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const artifacts: string[] = [];
    if (existsSync(join(projectRoot, "requirements.txt"))) artifacts.push("requirements.txt");
    if (existsSync(join(projectRoot, "pyproject.toml"))) artifacts.push("pyproject.toml");
    if (existsSync(join(projectRoot, "app.py"))) artifacts.push("app.py");
    if (existsSync(join(projectRoot, "src"))) artifacts.push("src");
    return { framework: "flask", projectRoot, artifacts };
  }
}

// ---------------------------------------------------------------------------
// Route scanner
// ---------------------------------------------------------------------------

/**
 * Decoradores `@<ident>.route('/path', methods=['GET', 'POST'])`.
 * Captura: 1=ident, 2=path, 3=methods.
 */
const ROUTE_RE =
  /@([a-zA-Z_][\w]*)\s*\.\s*route\s*\(\s*r?["']([^"']+)["']\s*(?:,\s*methods\s*=\s*\[([^\]]+)\])?/g;

/**
 * `app.add_url_rule('/path', view_func=..., methods=['GET'])`.
 */
const ADD_URL_RULE_RE =
  /add_url_rule\s*\(\s*r?["']([^"']+)["']\s*(?:,\s*[^)]*methods\s*=\s*\[([^\]]+)\])?/g;

export class FlaskRouteScanner implements IRouteScanner {
  readonly framework = "flask" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "flask";
  }

  async scan(match: IProjectMatch): Promise<ParsedRoute[]> {
    const out: ParsedRoute[] = [];
    const projectRoot = match.projectRoot;
    // 1) app.py + src/*.py + views.py.
    for (const entry of ["app.py", "views.py", "main.py"]) {
      const abs = join(projectRoot, entry);
      if (existsSync(abs)) {
        const rel = entry;
        out.push(...(await parseFlaskFile(abs, rel)));
      }
    }
    // 2) src/*.py.
    const srcDir = join(projectRoot, "src");
    if (existsSync(srcDir)) {
      await walkPy(srcDir, projectRoot, out);
    }
    // 3) <project>/<blueprint>/routes.py.
    const blueprints = await findBlueprints(projectRoot);
    for (const abs of blueprints) {
      const rel = abs.startsWith(projectRoot)
        ? abs.slice(projectRoot.length + 1).split("/").join("/")
        : abs;
      out.push(...(await parseFlaskFile(abs, rel, true)));
    }
    return out;
  }
}

async function walkPy(
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
    if (entry.endsWith(".py")) {
      const rel = full.startsWith(projectRoot)
        ? full.slice(projectRoot.length + 1).split("/").join("/")
        : full;
      out.push(...(await parseFlaskFile(full, rel)));
    } else if (!entry.includes(".")) {
      await walkPy(full, projectRoot, out);
    }
  }
}

async function findBlueprints(projectRoot: string): Promise<string[]> {
  // Retorna rutas ABSOLUTAS de .py files (no ParsedRoute[]).
  const out: string[] = [];
  for (const base of ["app", "apps", "src", "blueprints"]) {
    const dir = join(projectRoot, base);
    if (!existsSync(dir)) continue;
    await walkPyAbs(dir, out);
  }
  return out;
}

async function walkPyAbs(dir: string, out: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (entry.endsWith(".py")) {
      out.push(full);
    } else if (!entry.includes(".")) {
      await walkPyAbs(full, out);
    }
  }
}

async function parseFlaskFile(
  absPath: string,
  relPath: string,
  isBlueprint = false,
): Promise<ParsedRoute[]> {
  const out: ParsedRoute[] = [];
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch {
    return [];
  }
  const text = stripPyComments(raw);
  const lines = text.split("\n");

  // Detectar prefijo del Blueprint: `bp = Blueprint('users', __name__, url_prefix='/api/v1')`.
  let bpPrefix = "";
  if (isBlueprint) {
    const bpRe = /Blueprint\s*\(\s*['"][\w]+['"]\s*,\s*__name__\s*(?:,\s*url_prefix\s*=\s*['"]([^'"]+)['"])?/;
    const m = bpRe.exec(text);
    if (m?.[1]) bpPrefix = m[1];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    ROUTE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ROUTE_RE.exec(line)) !== null) {
      const ident = m[1] ?? "";
      const path = m[2] ?? "";
      const methodsList = m[3] ?? "";
      const methods = parseMethods(methodsList);
      if (methods.length === 0) methods.push("get");
      // Solo aceptar `app`, `bp`, `blueprint` o cualquier `<name>_bp` /
      // `<name>_blueprint` como idents.
      if (!/^(app|bp|blueprint|api)$/i.test(ident) && !/^[\w]+_(bp|blueprint)$/i.test(ident)) continue;
      const fullPath = joinRoutePath(bpPrefix, path);
      // Buscar signature del método abajo.
      let methodName = "";
      for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
        const sig = /def\s+([a-zA-Z_][\w]*)\s*\(/.exec(lines[j] ?? "");
        if (sig?.[1]) {
          methodName = sig[1];
          break;
        }
      }
      for (const method of methods) {
        out.push({
          method: method.toUpperCase(),
          uri: fullPath,
          rawUri: fullPath,
          sourceFile: relPath,
          lineNumber: i + 1,
          prefixChain: bpPrefix ? [bpPrefix] : [],
          displayName: methodName || `${method.toUpperCase()} ${path}`,
          ...(methodName ? { description: methodName } : {}),
        });
      }
    }
    ADD_URL_RULE_RE.lastIndex = 0;
    while ((m = ADD_URL_RULE_RE.exec(line)) !== null) {
      const path = m[1] ?? "";
      const methodsList = m[2] ?? "";
      const methods = parseMethods(methodsList);
      if (methods.length === 0) methods.push("get");
      const fullPath = joinRoutePath(bpPrefix, path);
      for (const method of methods) {
        out.push({
          method: method.toUpperCase(),
          uri: fullPath,
          rawUri: fullPath,
          sourceFile: relPath,
          lineNumber: i + 1,
          prefixChain: bpPrefix ? [bpPrefix] : [],
          displayName: `${method.toUpperCase()} ${path}`,
        });
      }
    }
  }
  return out;
}

function parseMethods(s: string): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((m) => m.trim().replace(/^['"]|['"]$/g, "").toLowerCase())
    .filter((m) => HTTP_METHODS.includes(m));
}

function stripPyComments(src: string): string {
  return src
    .replace(/"""[\s\S]*?"""/g, " ")
    .replace(/'''[\s\S]*?'''/g, " ")
    .replace(/^\s*#.*$/gm, "");
}

// ---------------------------------------------------------------------------
// Validation spec provider (no-op por ahora; bodies se generan con applyAgnosticInference)
// ---------------------------------------------------------------------------

/**
 * Provider de validación de Flask.
 *
 * Cubre las dos formas habituales de validar en Flask:
 *
 *   - **Marshmallow** (la más extendida):
 *       `class UserSchema(Schema): name = fields.Str(required=True)`
 *   - **Pydantic** vía `flask-pydantic`:
 *       `class UserCreate(BaseModel): name: str`
 *
 * El schema se asocia al endpoint en tres pasos de confianza
 * decreciente, igual que en los demás scanners:
 *
 *   1. El schema referenciado en el cuerpo del handler
 *      (`UserSchema().load(request.json)`, `body: UserCreate`).
 *   2. El que coincide por convención de nombre con el recurso de la
 *      ruta (`/api/users` → `UserSchema`, `UserCreateSchema`…).
 *   3. Ninguno: se deja que la inferencia agnóstica rellene el body.
 *
 * Antes esto era un stub que devolvía `[]` con `supports: false`, así
 * que Flask era el único framework con 0 endpoints con reglas reales.
 */
export class FlaskValidationProvider implements IValidationSpecProvider {
  readonly framework = "flask" as const;

  async supports(_route: ParsedRoute, _match: IProjectMatch): Promise<boolean> {
    return true;
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
  ): Promise<{ endpointKey: string; fields: IValidationSpec[] }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();

    // Los GET y DELETE no llevan body; sus params ya salen de la URI.
    if (route.method === "GET" || route.method === "DELETE") {
      return { endpointKey, fields: [] };
    }

    const schemas = await collectFlaskSchemas(match.projectRoot);
    if (schemas.size === 0) return { endpointKey, fields: [] };

    const handlerBody = await readHandlerBody(route, match.projectRoot);
    const chosen =
      pickSchemaByReference(handlerBody, schemas) ?? pickSchemaByConvention(route, schemas);

    return { endpointKey, fields: chosen ? [...chosen.specs] : [] };
  }
}

/** Un schema de validación localizado, ya convertido a specs. */
interface IFlaskSchema {
  readonly name: string;
  readonly specs: ReadonlyArray<IValidationSpec>;
}

/** Recorre el proyecto y recoge todos los schemas Marshmallow y Pydantic. */
async function collectFlaskSchemas(
  projectRoot: string,
): Promise<Map<string, IFlaskSchema>> {
  const out = new Map<string, IFlaskSchema>();

  for (const file of await collectPythonFiles(projectRoot)) {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const text = stripPyComments(raw);

    for (const schema of parseMarshmallowSchemas(text)) {
      if (schema.fields.size === 0) continue;
      out.set(schema.className, {
        name: schema.className,
        specs: marshmallowSchemaToSpecs(schema),
      });
    }
    for (const model of parsePydanticModels(text)) {
      if (model.fields.size === 0) continue;
      out.set(model.className, {
        name: model.className,
        specs: pydanticModelToSpecs(model),
      });
    }
  }
  return out;
}

/** Ficheros Python del proyecto, saltando tests y `__init__` vacíos. */
async function collectPythonFiles(projectRoot: string): Promise<string[]> {
  return collectFilesFrom(
    ["app", "src", "api", ""].map((dir) => (dir ? join(projectRoot, dir) : projectRoot)),
    (name) => name.endsWith(".py") && !name.startsWith("test_"),
  );
}

/**
 * Cuerpo del handler de una ruta: desde la línea del decorador hasta la
 * siguiente definición en columna 0.
 */
async function readHandlerBody(route: ParsedRoute, projectRoot: string): Promise<string> {
  if (!route.sourceFile) return "";
  let raw: string;
  try {
    raw = await readFile(join(projectRoot, route.sourceFile), "utf8");
  } catch {
    return "";
  }
  const lines = stripPyComments(raw).split("\n");
  const start = Math.max(0, route.lineNumber - 1);
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (i > start + 1 && line.trim() !== "" && !/^\s/.test(line) && !line.startsWith("@")) {
      break;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Paso 1: el schema que el handler nombra explícitamente. */
function pickSchemaByReference(
  handlerBody: string,
  schemas: ReadonlyMap<string, IFlaskSchema>,
): IFlaskSchema | null {
  if (!handlerBody) return null;
  for (const [name, schema] of schemas) {
    if (new RegExp(`\\b${name}\\b`).test(handlerBody)) return schema;
  }
  return null;
}

/** Paso 2: el schema cuyo nombre casa con el recurso de la ruta. */
function pickSchemaByConvention(
  route: ParsedRoute,
  schemas: ReadonlyMap<string, IFlaskSchema>,
): IFlaskSchema | null {
  const segments = route.uri
    .split("/")
    .filter((s) => s && !s.includes("<") && !s.includes("{") && s !== "api");
  if (segments.length === 0) return null;

  const resource = segments[segments.length - 1]!;
  const singular = resource.replace(/s$/, "");
  const candidates = [
    `${capitalize(singular)}Schema`,
    `${capitalize(resource)}Schema`,
    `${capitalize(singular)}Create`,
    `Create${capitalize(singular)}`,
    capitalize(singular),
  ];

  for (const candidate of candidates) {
    const found = schemas.get(candidate);
    if (found) return found;
  }
  return null;
}

function capitalize(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
