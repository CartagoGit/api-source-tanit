/**
 * `FastApiRouteScanner` — implementation of `IProjectScanner` + `IRouteScanner`
 * + `IValidationSpecProvider` for FastAPI (Python) projects.
 *
 * Detection:
 *   - `pyproject.toml` or `requirements.txt` with `fastapi` or `fastapi[...]`.
 *   - Auto-detects the project root from `pyproject.toml` or `requirements.txt`.
 *
 * Parsing:
 *   - Path-operation decorators: `@app.METHOD('/path')`, `@router.METHOD('/path')`.
 *   - Pydantic BaseModel fields → `IValidationSpec`.
 *   - Supported methods: get, post, put, delete, patch, options, head.
 *
 * If the project also exposes `/openapi.json` or `/docs` (Swagger UI),
 * the `OpenApiRouteScanner` will discover it automatically because it
 * looks for these paths at the project root. We only cover the static
 * case here (no server running).
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { readFile, } from "node:fs/promises";
import { join, sep } from "node:path";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import { collectFilesFrom } from "../../core/helpers/fs-walk.helper.js";
import { parsePydanticModels, pydanticFieldToSpec } from "../parsers/pydantic-schema.helper.js";
import { effectiveProjectRoot, rawProjectRoot } from "../../core/discovery/effective-project-root.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";

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

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const signals: Array<{ signal: string; weight: number; artifact?: string }> = [];
    for (const file of ["pyproject.toml", "requirements.txt", "Pipfile"]) {
      const p = join(projectRoot, file);
      if (!existsSync(p)) continue;
      try {
        const text = await readFile(p, "utf8");
        if (/\bfastapi\b/i.test(text)) {
          signals.push({
            signal: `fastapi mencionado en ${file}`,
            weight: 1,
            artifact: file,
          });
        }
      } catch {
        /* ignore */
      }
    }
    if (signals.length === 0) return emptyResult(0);
    return withEvidence(1, signals);
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

export class FastApiRouteScanner implements IRouteScanner {
  readonly framework = "fastapi" as const;

  matches(_match: IProjectMatch): boolean {
    return _match.framework === "fastapi";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const files = await collectPyFiles(effectiveProjectRoot(match));
    const routerPrefixes = new Map<string, string>();
    const out: ParsedRoute[] = [];

    // Parallel reads with a cap, in input order: the collection has to
    // come out identical on every run.
    for await (const { path: file, text: raw } of readFilesInOrder(files)) {
      const text = stripComments(raw);
      const lines = text.split("\n");

      // 1) Collect routers with prefix.
      for (const line of lines) {
        const prefixMatch = new RegExp(ROUTER_PREFIX_RE.source, "gi").exec(line);
        if (prefixMatch?.[2]) {
          const varMatch = new RegExp(ROUTER_VAR_RE.source, "gi").exec(line);
          if (varMatch?.[1]) routerPrefixes.set(varMatch[1], prefixMatch[2]);
        }
      }

      // 2) Collect path-operation decorators.
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
            .replace(rawProjectRoot(match), "")
            .replace(/^[\\/]/, "")
            .split(sep)
            .join("/");

          // Look for the handler name in the next lines (typical: `def handlerName(`).
          let handlerName: string | undefined;
          for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
            const hm = /^(?:async\s+)?def\s+([a-zA-Z_][\w]*)\s*\(/.exec(lines[j] ?? "");
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

    return { routes: out };
  }
}

// ---------------------------------------------------------------------------
// Validation provider (Pydantic BaseModel)
// ---------------------------------------------------------------------------

interface ModelInfo {
  /** className → fields. */
  readonly fields: ReadonlyMap<string, string>;
  /** File where the model is defined. */
  readonly file: string;
  /** Line where `class ModelName(BaseModel):` is. */
  readonly line: number;
}

export class FastApiPydanticValidationProvider implements IValidationSpecProvider {
  readonly framework = "fastapi" as const;

  async supports(
    _route: ParsedRoute,
    _match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<boolean> {
    return true;
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<{ endpointKey: string; fields: IValidationSpec[] }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    const files = await collectPyFiles(effectiveProjectRoot(match));
    const models: Map<string, ModelInfo> = new Map();

    // 1) Collect all the project's BaseModels.
    // Parallel reads with a cap, in input order: the collection has to
    // come out identical on every run.
    for await (const { path: file, text: raw } of readFilesInOrder(files)) {
      for (const model of parsePydanticModels(stripComments(raw))) {
        models.set(model.className, {
          fields: model.fields,
          file,
          line: model.line,
        });
      }
    }

    // 2) Without known BaseModels, return empty.
    if (models.size === 0) return { endpointKey, fields: [] };

    // 3) Map the endpoint to the correct model.
    const candidate = await pickModelForRoute(route, models, files);
    if (!candidate) return { endpointKey, fields: [] };

    const fields = [...candidate.fields].map(([fieldName, annotation]) =>
      pydanticFieldToSpec(fieldName, annotation),
    );
    return { endpointKey, fields };
  }
}

/**
 * Chooses the right BaseModel for an endpoint.
 *
 * Heuristic (priority order):
 *   a. **Type annotation in the handler**: `def create_user(req: CreateUserRequest): ...`
 *      The scanner already has `route.displayName` with the function
 *      name, and `route.sourceFile` + `route.lineNumber` point to the
 *      decorator's line. We look up the handler in the file and parse
 *      its signature.
 *   b. **Naming convention**: `POST /users` → `CreateUserRequest`, `GET /users` → `ListUsersRequest`.
 *   c. **Fallback**: first model of the file.
 */
async function pickModelForRoute(
  route: ParsedRoute,
  models: Map<string, ModelInfo>,
  files: string[],
): Promise<ModelInfo | null> {
  // a) Type annotation in the handler.
  if (route.displayName) {
    const handlerName = route.displayName.trim();
    for (const file of files) {
      const text = await readFile(file, "utf8").catch(() => "");
      if (!text) continue;
      // `def handlerName(` followed by a typed parameter with a BaseModel.
      // Match: any model that is a BaseModel (not only `*Request`).
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

  // b) Naming convention.
  const method = route.method.toUpperCase();

  // If the path has `{id}` or a path-param, it's not typically a body:
  //   GET /users/{id}   → no body
  //   DELETE /users/{id} → no body
  //   PUT /users/{id}    → YES body (UpdateUserRequest)
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

  // Convention: {Verb}{Resource}Request
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

  // c) Fallback: first model of the file.
  if (route.sourceFile) {
    for (const info of models.values()) {
      if (info.file.endsWith(route.sourceFile)) return info;
    }
  }
  // Last fallback: first global model.
  const first = models.values().next().value;
  return first ?? null;
}

/** Escapa un string para usarlo en una regex literal. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
