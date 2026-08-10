/**
 * `FastApiScanner` — implementación de `IProjectScanner` + `IRouteScanner`
 * + `IValidationSpecProvider` para proyectos FastAPI (Python).
 *
 * Detección:
 *   - `pyproject.toml` o `requirements.txt` con `fastapi` o `fastapi[...]`.
 *   - Auto-detecta la raíz del proyecto desde `pyproject.toml` o `requirements.txt`.
 *
 * Parsing:
 *   - Decoradores de path operations: `@app.METHOD('/path')`, `@router.METHOD('/path')`.
 *   - Pydantic BaseModel fields → `IValidationSpec`.
 *   - Métodos soportados: get, post, put, delete, patch, options, head.
 *
 * Si el proyecto también expone `/openapi.json` o `/docs` (Swagger UI),
 * el `OpenApiScanner` lo descubrirá automáticamente porque busca
 * estos paths en la raíz del proyecto. Aquí solo cubrimos el caso
 * estático (sin servidor corriendo).
 */
import { existsSync } from "node:fs";
import { readFile, } from "node:fs/promises";
import { join, sep } from "node:path";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import { collectFilesFrom } from "../../core/helpers/fs-walk.helper.js";
import { parsePydanticModels, pydanticFieldToSpec } from "../parsers/pydantic-schema.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contracts/interfaces/core/scanner.interface.js";

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "options",
  "head",
] as const;

// Regex para `@app.METHOD('/path')` o `@router.METHOD('/path')`.
// Captura: 1=ident (router name), 2=method, 3=path (comilla o doble).
const DECORATOR_RE =
  /@\s*([a-zA-Z_$][\w$]*)\s*\.\s*(get|post|put|delete|patch|options|head)\s*\(\s*(['"])([^'"]+)\3/gi;

// Decoradores con router prefix: `APIRouter(prefix='/api/v1')`.
const ROUTER_PREFIX_RE =
  /APIRouter\s*\(\s*[^)]*prefix\s*=\s*(['"])([^'"]+)\1/gi;
const ROUTER_VAR_RE = /([a-zA-Z_$][\w$]*)\s*=\s*APIRouter/gi;

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export class FastApiProjectScanner implements IProjectScanner {
  readonly framework = "fastapi" as const;

  async detect(projectRoot: string): Promise<number> {
    let score = 0;
    for (const file of ["pyproject.toml", "requirements.txt", "Pipfile"]) {
      const p = join(projectRoot, file);
      if (!existsSync(p)) continue;
      try {
        const text = await readFile(p, "utf8");
        if (/\bfastapi\b/i.test(text)) score = Math.max(score, 1);
      } catch {
        /* ignore */
      }
    }
    return score;
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const artifacts: string[] = [];
    for (const rel of ["pyproject.toml", "requirements.txt", "main.py", "app/main.py", "src/main.py", "app.py"]) {
      if (existsSync(join(projectRoot, rel))) artifacts.push(rel);
    }
    return { framework: "fastapi", projectRoot, artifacts };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripComments(src: string): string {
  return src
    .replace(/"""[\s\S]*?"""/g, "")
    .replace(/'''[\s\S]*?'''/g, "")
    .replace(/(^|[^:])#.*$/gm, "$1");
}

async function collectPyFiles(projectRoot: string): Promise<string[]> {
  return collectFilesFrom(
    ["app", "src", "lib", ""].map((dir) => (dir ? join(projectRoot, dir) : projectRoot)),
    (name) => name.endsWith(".py") && !name.startsWith("test_") && !name.startsWith("_"),
  );
}

// ---------------------------------------------------------------------------
// Route scanner
// ---------------------------------------------------------------------------

export class FastApiScanner implements IRouteScanner {
  readonly framework = "fastapi" as const;

  matches(_match: IProjectMatch): boolean {
    return _match.framework === "fastapi";
  }

  async scan(match: IProjectMatch): Promise<ReadonlyArray<ParsedRoute>> {
    const files = await collectPyFiles(match.projectRoot);
    const routerPrefixes = new Map<string, string>();
    const out: ParsedRoute[] = [];

    // En paralelo con tope, en el orden de entrada: la colección
    // tiene que salir igual en cada ejecución.
    for await (const { path: file, text: raw } of readFilesInOrder(files)) {
      const text = stripComments(raw);
      const lines = text.split("\n");

      // 1) Recoger routers con prefix.
      for (const line of lines) {
        const prefixMatch = new RegExp(ROUTER_PREFIX_RE.source, "gi").exec(line);
        if (prefixMatch?.[2]) {
          const varMatch = new RegExp(ROUTER_VAR_RE.source, "gi").exec(line);
          if (varMatch?.[1]) routerPrefixes.set(varMatch[1], prefixMatch[2]);
        }
      }

      // 2) Recoger decoradores de path operations.
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const re = new RegExp(DECORATOR_RE.source, "gi");
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          const ident = (m[1] ?? "").trim();
          const method = (m[2] ?? "").toLowerCase();
          const path = (m[4] ?? "").trim();
          if (!(HTTP_METHODS as readonly string[]).includes(method)) continue;
          if (!path.startsWith("/")) continue;
          let prefix = "";
          if (ident !== "app" && routerPrefixes.has(ident)) {
            prefix = routerPrefixes.get(ident) ?? "";
          }
          const fullPath = (prefix + path).replace(/\/+/g, "/");
          const relFile = file
            .replace(match.projectRoot, "")
            .replace(/^[\\/]/, "")
            .split(sep)
            .join("/");

          // Buscar el handler name en las siguientes líneas (típico: `def handlerName(`).
          let handlerName: string | undefined;
          for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
            const hm = /^def\s+([a-zA-Z_][\w]*)\s*\(/.exec(lines[j] ?? "");
            if (hm?.[1]) {
              handlerName = hm[1];
              break;
            }
          }

          out.push({
            method: method.toUpperCase(),
            uri: fullPath,
            rawUri: path,
            sourceFile: relFile,
            lineNumber: i + 1,
            prefixChain: prefix ? [prefix.replace(/^\/|\/$/g, "")] : [],
            ...(handlerName ? { displayName: handlerName } : {}),
          });
        }
      }
    }

    return out;
  }
}

// ---------------------------------------------------------------------------
// Validation provider (Pydantic BaseModel)
// ---------------------------------------------------------------------------

interface ModelInfo {
  /** className → fields. */
  readonly fields: ReadonlyMap<string, string>;
  /** Fichero donde está definida. */
  readonly file: string;
  /** Línea donde está `class ModelName(BaseModel):`. */
  readonly line: number;
}

export class FastApiPydanticValidationProvider implements IValidationSpecProvider {
  readonly framework = "fastapi" as const;

  async supports(_route: ParsedRoute, _match: IProjectMatch): Promise<boolean> {
    return true;
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
  ): Promise<{ endpointKey: string; fields: IValidationSpec[] }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    const files = await collectPyFiles(match.projectRoot);
    const models: Map<string, ModelInfo> = new Map();

    // 1) Recoger todos los BaseModel del proyecto.
    // En paralelo con tope, en el orden de entrada: la colección
    // tiene que salir igual en cada ejecución.
    for await (const { path: file, text: raw } of readFilesInOrder(files)) {
      for (const model of parsePydanticModels(stripComments(raw))) {
        models.set(model.className, {
          fields: model.fields,
          file,
          line: model.line,
        });
      }
    }

    // 2) Sin BaseModel conocidos, devolver vacío.
    if (models.size === 0) return { endpointKey, fields: [] };

    // 3) Mapear el endpoint al modelo correcto.
    const candidate = await pickModelForRoute(route, models, files);
    if (!candidate) return { endpointKey, fields: [] };

    const fields = [...candidate.fields].map(([fieldName, annotation]) =>
      pydanticFieldToSpec(fieldName, annotation),
    );
    return { endpointKey, fields };
  }
}

/**
 * Elige el BaseModel apropiado para un endpoint.
 *
 * Heurística (orden de prioridad):
 *   a. **Anotación de tipo en el handler**: `def create_user(req: CreateUserRequest): ...`
 *      El scanner ya tiene `route.displayName` con el nombre de la función,
 *      y `route.sourceFile` + `route.lineNumber` apunta a la línea del decorador.
 *      Buscamos el handler en el archivo y parseamos su firma.
 *   b. **Convención de nombre**: `POST /users` → `CreateUserRequest`, `GET /users` → `ListUsersRequest`.
 *   c. **Fallback**: primer modelo del fichero.
 */
async function pickModelForRoute(
  route: ParsedRoute,
  models: Map<string, ModelInfo>,
  files: string[],
): Promise<ModelInfo | null> {
  // a) Anotación de tipo en el handler.
  if (route.displayName) {
    const handlerName = route.displayName.trim();
    for (const file of files) {
      const text = await readFile(file, "utf8").catch(() => "");
      if (!text) continue;
      // `def handlerName(` seguido de un parámetro tipado con un BaseModel.
      // Match: cualquier model que sea un BaseModel (no solo `*Request`).
      const handlerRe = new RegExp(
        `def\\s+${escapeRegex(handlerName)}\\s*\\([^)]*?\\s*:\\s*([A-Z]\\w*)\\b`,
        "s",
      );
      const m = handlerRe.exec(text);
      if (m?.[1]) {
        const model = models.get(m[1]);
        if (model) return model;
      }
    }
  }

  // b) Convención de nombre.
  const method = route.method.toUpperCase();

  // Si el path tiene `{id}` o path-param, no es un body típicamente:
  //   GET /users/{id}   → no body
  //   DELETE /users/{id} → no body
  //   PUT /users/{id}    → SÍ body (UpdateUserRequest)
  const hasPathParam = route.uri.includes("{") || route.uri.includes("{{");
  if (method === "GET" && hasPathParam) return null;
  if (method === "DELETE") return null;

  const segs = route.uri
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .filter((s) => !s.startsWith("{") && !s.startsWith("{{"));
  const resource = segs[segs.length - 1] ?? "";
  const singular = resource.replace(/s$/, "");
  const capitalized = resource
    ? resource.charAt(0).toUpperCase() + resource.slice(1)
    : "";
  const singularCap = singular
    ? singular.charAt(0).toUpperCase() + singular.slice(1)
    : "";

  // Convención: {Verbo}{Resource}Request
  //   POST /users        → CreateUserRequest
  //   PUT /users/{id}    → UpdateUserRequest
  //   GET /users         → ListUsersRequest
  const candidates: string[] = [];
  if (method === "POST") {
    candidates.push(`Create${singularCap}Request`, `Create${capitalized}Request`);
  } else if (method === "PUT" || method === "PATCH") {
    candidates.push(`Update${singularCap}Request`, `Update${capitalized}Request`);
  } else if (method === "GET") {
    candidates.push(`List${capitalized}Request`, `Filter${capitalized}Request`);
  }
  for (const name of candidates) {
    const model = models.get(name);
    if (model) return model;
  }

  // c) Fallback: primer modelo del fichero.
  if (route.sourceFile) {
    for (const info of models.values()) {
      if (info.file.endsWith(route.sourceFile)) return info;
    }
  }
  // Último fallback: primer modelo global.
  const first = models.values().next().value;
  return first ?? null;
}

/** Escapa un string para usarlo en una regex literal. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
