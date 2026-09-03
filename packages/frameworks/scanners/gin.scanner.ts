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
import { emptyResult, withEvidence } from "./detect-result.helper";
import { ownRegex } from "../../core/helpers/regex.helper.js";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { stripJsComments } from "../../core/helpers/source-scan.helper.js";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";

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

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const isGin = await isGinProject(projectRoot);
    if (!isGin) return emptyResult(0);
    const hasMain = existsSync(join(projectRoot, "main.go"));
    const hasCmd = existsSync(join(projectRoot, "cmd"));
    return withEvidence(hasMain || hasCmd ? 1 : 0.5, [
      { signal: "go.mod con import gin-gonic/gin", weight: hasMain || hasCmd ? 0.7 : 0.5, artifact: "go.mod" },
      ...(hasMain ? [{ signal: "main.go presente", weight: 0.2, artifact: "main.go" }] : []),
      ...(hasCmd ? [{ signal: "cmd/ presente", weight: 0.1, artifact: "cmd/" }] : []),
    ]);
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
const ROUTE_RE = /([a-zA-Z_][\w.]*)\s*\.\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*"([^"]+)"/g;

const GROUP_RE = /([a-zA-Z_][\w]*)\s*:?=\s*[a-zA-Z_][\w]*\s*\.\s*Group\s*\(\s*"([^"]+)"/g;

export class GinRouteScanner implements IRouteScanner {
  readonly framework = "gin" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "gin";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const out: ParsedRoute[] = [];
    const projectRoot = match.projectRoot;
    // 1) main.go (si está en raíz).
    const main = join(projectRoot, "main.go");
    if (existsSync(main)) {
      out.push(...(await parseGoFile(main, "main.go", projectRoot)));
    }
    // 2) cmd/, pkg/, internal/, src/ — recursivo.
    await findAllGoFiles(projectRoot).then(async (files) => {
      for (const f of files) {
        const rel = f.startsWith(projectRoot)
          ? f.slice(projectRoot.length + 1).split("/").join("/")
          : f;
        // Evitar duplicar main.go raíz.
        if (rel === "main.go") continue;
        out.push(...(await parseGoFile(f, rel, projectRoot)));
      }
    });
    return { routes: out };
  }
}


/**
 * Busca recursivamente todos los `.go` del proyecto (retorna solo paths).
 */
async function findAllGoFiles(projectRoot: string): Promise<string[]> {
  const out: string[] = [];
  async function collect(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (entry.endsWith(".go")) out.push(full);
      else if (!entry.includes(".")) await collect(full);
    }
  }
  for (const base of ["cmd", "pkg", "internal", "src"]) {
    const dir = join(projectRoot, base);
    if (!existsSync(dir)) continue;
    await collect(dir);
  }
  return out;
}

async function parseGoFile(
  absPath: string,
  relPath: string,
  _projectRoot: string,
): Promise<ParsedRoute[]> {
  const out: ParsedRoute[] = [];
  let source: string;
  try {
    source = await readFile(absPath, "utf8");
  } catch {
    return [];
  }
  // Sin esto, una ruta comentada acababa en la colección del usuario.
  // Go comparte la sintaxis de comentarios de JS/TS.
  const raw = stripJsComments(source);

  // 1) Detectar prefixes de Groups.
  const groupPrefix = new Map<string, string>();
  let m: RegExpExecArray | null;
  const groupRe = ownRegex(GROUP_RE);
  while ((m = groupRe.exec(raw)) !== null) {
    const ident = m[1] ?? "";
    const prefix = m[2] ?? "";
    groupPrefix.set(ident, prefix);
  }
  // 2) Buscar routes.
  const routeRe = ownRegex(ROUTE_RE);
  while ((m = routeRe.exec(raw)) !== null) {
    const ident = m[1] ?? "";
    const method = (m[2] ?? "").toLowerCase();
    const path = m[3] ?? "";
    if (!HTTP_METHODS.includes(method)) continue;
    const prefix = groupPrefix.get(ident) ?? "";
    const fullPath = joinRoutePath(prefix, path);
    out.push({
      method: method.toUpperCase(),
      uri: fullPath,
      rawUri: path,
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

  async supports(
    route: ParsedRoute,
    match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<boolean> {
    if (match.framework !== "gin") return false;
    // Buscar archivos .go en el proyecto que puedan contener structs.
    return route.sourceFile !== undefined;
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<{ endpointKey: string; fields: IValidationSpec[] }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    if (!route.sourceFile) return { endpointKey, fields: [] };
    const abs = join(match.projectRoot, route.sourceFile);
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      return { endpointKey, fields: [] };
    }
    let fields = parseGoStructs(raw, route.uri);
    if (fields.length === 0) {
      // Fallback: buscar structs en otros archivos .go del proyecto.
      const files = await findAllGoFiles(match.projectRoot);
      // Filtrar archivos cuyo nombre sugiere relevancia al URI.
      const uriWords = (route.uri ?? "")
        .split("/")
        .filter((w) => w && !w.startsWith("{{") && !w.startsWith(":"))
        .map((w) => w.toLowerCase().replace(/s$/, ""));
      const ranked = files
        .map((f) => {
          const lower = f.toLowerCase();
          const score = uriWords.reduce(
            (acc, w) => (w && lower.includes(w) ? acc + 1 : acc),
            0,
          );
          return { f, score };
        })
        .sort((a, b) => b.score - a.score);
      for (const { f } of ranked) {
        let otherRaw: string;
        try {
          otherRaw = await readFile(f, "utf8");
        } catch {
          continue;
        }
        fields = parseGoStructsInFile(otherRaw, route.uri);
        if (fields.length > 0) break;
      }
    }
    if (fields.length === 0) return { endpointKey, fields: [] };
    // Solo aplicar a métodos que aceptan body (POST/PUT/PATCH).
    if (!["POST", "PUT", "PATCH"].includes(route.method.toUpperCase())) {
      return { endpointKey, fields: [] };
    }
    const bodySpecs = fields.map((f) => ({ ...f, location: "body" as const }));
    return { endpointKey, fields: bodySpecs };
  }
}

/**
 * Parsea structs Go del archivo y extrae fields con binding tags.
 * Estrategia: encontrar `type X struct { ... }` y para cada field capturar
 * el `binding:"..."` tag.
 */
function parseGoStructsInFile(raw: string, uri?: string): IValidationSpec[] {
  // Coleccionar (struct name, fields[]) por struct del archivo.
  const structMap: Array<{ name: string; fields: IValidationSpec[] }> = [];
  return parseStructsAndPick(raw, structMap, uri);
}

function parseGoStructs(raw: string, uri?: string): IValidationSpec[] {
  // Legacy: combina todos los structs en un structMap.
  const structMap: Array<{ name: string; fields: IValidationSpec[] }> = [];
  return parseStructsAndPick(raw, structMap, uri);
}

function parseStructsAndPick(
  raw: string,
  structMap: Array<{ name: string; fields: IValidationSpec[] }>,
  uri?: string,
): IValidationSpec[] {
  // Regex: `type X struct {` con captura del body y nombre.
  const typeRe = /type\s+(\w+)\s+struct\s*\{([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null;
  while ((m = typeRe.exec(raw)) !== null) {
    const structName = m[1] ?? "";
    const structBody = m[2] ?? "";
    const fields: IValidationSpec[] = [];
    const fieldRe = /(\w+)\s+[\w\[\]\*]+\s+`[^`]*?json:"([^"]+)"[^`]*?binding:"([^"]+)"[^`]*?`/g;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(structBody)) !== null) {
      const fieldName = fm[1] ?? "";
      const wireName = fm[2] ?? fieldName;
      const binding = fm[3] ?? "";
      if (!binding) continue;
      const tags = binding.split(",").map((s) => s.trim());
      const required = tags.includes("required");
      const oneof = tags.find((t) => t.startsWith("oneof="));
      const spec: IValidationSpec = {
        fieldName: wireName,
        location: "body",
        type: inferGoFieldType(binding, fieldName),
        required,
      };
      if (oneof) {
        spec.enumValues = oneof.slice("oneof=".length).split(/\s+/).filter(Boolean);
        spec.type = "enum";
      }
      if (binding.includes("email")) spec.format = "email";
      fields.push(spec);
    }
    if (fields.length > 0) structMap.push({ name: structName, fields });
  }
  // Si solo hay un struct → usar ese.
  if (structMap.length === 1) return structMap[0]!.fields;
  // Si hay varios y tenemos URI, intentar matchear el nombre del struct
  // con palabras del último segmento del path (o del path completo).
  if (structMap.length > 1 && uri) {
    const lastSeg = uri.split("/").filter(Boolean).pop() ?? "";
    const candidates = [
      lastSeg,
      lastSeg.replace(/s$/, ""), // users → user
      lastSeg.replace(/-/g, ""),
    ];
    for (const seg of candidates) {
      if (!seg) continue;
      const lname = seg.charAt(0).toUpperCase() + seg.slice(1);
      const exact = structMap.find((s) => s.name === lname);
      if (exact) return exact.fields;
      const startsWith = structMap.find((s) => s.name.startsWith(lname));
      if (startsWith) return startsWith.fields;
    }
    // Match por cualquier palabra del path: /api/users/{id}/address
    // → buscar struct que contenga "User", "Address", "Users", etc.
    const allWords = uri
      .split("/")
      .filter((w) => w && !w.startsWith("{{") && !w.startsWith(":"));
    for (const word of allWords) {
      const lword = word.charAt(0).toUpperCase() + word.slice(1);
      const match = structMap.find(
        (s) => s.name === lword || s.name === lword.replace(/s$/, ""),
      );
      if (match) return match.fields;
    }
  }
  // Si hay varios → usar el más pequeño (heurística: payload mínimo).
  if (structMap.length > 1) {
    structMap.sort((a, b) => a.fields.length - b.fields.length);
    return structMap[0]!.fields;
  }
  return [];
}

function inferGoFieldType(binding: string, fieldName: string): IValidationSpec["type"] {
  if (binding.includes("email")) return "string";
  if (binding.includes("oneof=")) return "enum";
  if (binding.includes("min=") || binding.includes("max=") || binding.includes("len=")) {
    // Heurística: si el nombre tiene "id", "count", "age", "amount" → number.
    if (/id|count|age|amount|number|num$/i.test(fieldName)) return "integer";
    return "string";
  }
  if (binding.includes("gte=") || binding.includes("lte=") || binding.includes("gt=") || binding.includes("lt=")) {
    return "integer";
  }
  return "string";
}
