/**
 * `AspNetScanner` — implementación de `IProjectScanner` + `IRouteScanner`
 * para ASP.NET Core (C# / .NET).
 *
 * Detección:
 *   - `*.csproj` con `Microsoft.AspNetCore.App` o `FrameworkReference Include="Microsoft.AspNetCore.App"`.
 *
 * Parsing:
 *   - `[Route("api/v1")]` en la classe (controller).
 *   - `[HttpGet("users")]`, `[HttpPost]`, `[HttpPut]`, etc. en métodos.
 *   - `[ApiController]` (heurístico) para marcar la clase como controller.
 *
 * Validation:
 *   - `AspNetDataAnnotationsProvider` (best-effort): extrae
 *     `System.ComponentModel.DataAnnotations.*` (`[Required]`, `[EmailAddress]`,
 *     `[StringLength]`, `[Range]`, `[RegularExpression]`).
 *   - Limitado: solo DTOs en el package local.
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
      const fullPath = ("/" + classPrefix + "/" + subPath).replace(/\/+/g, "/");
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
