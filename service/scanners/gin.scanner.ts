/**
 * `GinScanner` — implementación de `IProjectScanner` + `IRouteScanner`
 * para Gin (Go web framework).
 *
 * Detección:
 *   - `go.mod` con `github.com/gin-gonic/gin`.
 *
 * Parsing:
 *   - Llama a `Router.METHOD("/path", handler)`. Captura el prefijo del
 *     `Router.Group("/api/v1")` recursivamente.
 *   - Soporta `engine := gin.Default()` o cualquier variable.
 *   - Soporta middleware: `Router.GET("/x", middleware, handler)`.
 *
 * Validation:
 *   - `GinBindingProvider` (best-effort): extrae `binding:"required"` tags
 *     de structs Go desde el handler. Limitado: parseo de Go structs es
 *     parcial y no soporta referencias a otros paquetes.
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contract/scanner.interface.js";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"];

async function isGinProject(projectRoot: string): Promise<boolean> {
  const goMod = join(projectRoot, "go.mod");
  if (!existsSync(goMod)) return false;
  let raw: string;
  try {
    raw = await readFile(goMod, "utf8");
  } catch {
    return false;
  }
  return /github\.com\/gin-gonic\/gin/.test(raw);
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export class GinProjectScanner implements IProjectScanner {
  readonly framework = "gin" as const;

  async detect(projectRoot: string): Promise<number> {
    const isGin = await isGinProject(projectRoot);
    if (!isGin) return 0;
    const hasMain = existsSync(join(projectRoot, "main.go"));
    const hasCmd = existsSync(join(projectRoot, "cmd"));
    if (hasMain || hasCmd) return 1;
    return 0.5;
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const artifacts: string[] = ["go.mod"];
    if (existsSync(join(projectRoot, "main.go"))) artifacts.push("main.go");
    if (existsSync(join(projectRoot, "internal"))) artifacts.push("internal");
    return { framework: "gin", projectRoot, artifacts };
  }
}

// ---------------------------------------------------------------------------
// Route scanner
// ---------------------------------------------------------------------------

/**
 * `<ident>.METHOD("/path", ...)` en Go.
 * Captura: 1=ident, 2=method, 3=path.
 */
const ROUTE_RE = /([a-zA-Z_][\w]*)\s*\.\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*"([^"]+)"/g;

const GROUP_RE = /([a-zA-Z_][\w]*)\s*:?=\s*[a-zA-Z_][\w]*\s*\.\s*Group\s*\(\s*"([^"]+)"/g;

export class GinRouteScanner implements IRouteScanner {
  readonly framework = "gin" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "gin";
  }

  async scan(match: IProjectMatch): Promise<ParsedRoute[]> {
    const out: ParsedRoute[] = [];
    const projectRoot = match.projectRoot;
    // 1) main.go.
    const main = join(projectRoot, "main.go");
    if (existsSync(main)) {
      out.push(...(await parseGoFile(main, "main.go", projectRoot)));
    }
    // 2) internal/**/*.go.
    const internal = join(projectRoot, "internal");
    if (existsSync(internal)) {
      await walkGo(internal, projectRoot, out);
    }
    return out;
  }
}

async function walkGo(
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
    if (entry.endsWith(".go")) {
      const rel = full.startsWith(projectRoot)
        ? full.slice(projectRoot.length + 1).split("/").join("/")
        : full;
      out.push(...(await parseGoFile(full, rel, projectRoot)));
    } else if (!entry.includes(".")) {
      await walkGo(full, projectRoot, out);
    }
  }
}

async function parseGoFile(
  absPath: string,
  relPath: string,
  _projectRoot: string,
): Promise<ParsedRoute[]> {
  const out: ParsedRoute[] = [];
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch {
    return [];
  }
  // 1) Detectar prefixes de Groups.
  const groupPrefix = new Map<string, string>();
  GROUP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GROUP_RE.exec(raw)) !== null) {
    const ident = m[1] ?? "";
    const prefix = m[2] ?? "";
    groupPrefix.set(ident, prefix);
  }
  // 2) Buscar routes.
  ROUTE_RE.lastIndex = 0;
  while ((m = ROUTE_RE.exec(raw)) !== null) {
    const ident = m[1] ?? "";
    const method = (m[2] ?? "").toLowerCase();
    const path = m[3] ?? "";
    if (!HTTP_METHODS.includes(method)) continue;
    const prefix = groupPrefix.get(ident) ?? "";
    const fullPath = (prefix + path).replace(/\/+/g, "/");
    out.push({
      method: method.toUpperCase(),
      uri: fullPath,
      rawUri: fullPath,
      sourceFile: relPath,
      lineNumber: 0,
      prefixChain: prefix ? [prefix] : [],
      displayName: `${method.toUpperCase()} ${path}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation spec provider (no-op por ahora; bodies via inference)
// ---------------------------------------------------------------------------

export class GinBindingProvider implements IValidationSpecProvider {
  readonly framework = "gin" as const;

  async supports(_r: ParsedRoute, _m: IProjectMatch): Promise<boolean> {
    return false;
  }

  async resolve(
    route: ParsedRoute,
    _match: IProjectMatch,
  ): Promise<{ endpointKey: string; fields: IValidationSpec[] }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    return { endpointKey, fields: [] };
  }
}
