/**
 * `GinScanner` — implementation of `IProjectScanner` + `IRouteScanner`
 * for Gin (Go web framework).
 *
 * Detection:
 *   - `go.mod` with `github.com/gin-gonic/gin`.
 *
 * Parsing:
 *   - Calls `Router.METHOD("/path", handler)`. Captures the prefix from
 *     `Router.Group("/api/v1")` recursively.
 *   - Supports `engine := gin.Default()` or any variable.
 *   - Supports middleware: `Router.GET("/x", middleware, handler)`.
 *
 * Validation:
 *   - `GinBindingProvider` (best-effort): extracts `binding:"required"`
 *     tags from Go structs referenced by the handler. Limited: Go
 *     struct parsing is partial and does not support references to
 *     other packages.
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { ownRegex } from "../../core/helpers/regex.helper.js";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { stripJsComments } from "../../core/helpers/source-scan.helper.js";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
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
  // a00010 / B-02: `HEAD` and `OPTIONS` were recognised by the regex
  // (`ROUTE_RE`) but the list below silently dropped them. Postman
  // supports them; an `r.HEAD("/health")` ended up missing from the
  // collection.
  "head",
  "options",
];

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
    const evidence = [
      { signal: "go.mod con import gin-gonic/gin", weight: 0.7, artifact: "go.mod" },
      ...(hasMain ? [{ signal: "main.go presente", weight: 0.2, artifact: "main.go" }] : []),
      ...(hasCmd ? [{ signal: "cmd/ presente", weight: 0.1, artifact: "cmd/" }] : []),
    ];
    return withEvidence(evidence.reduce((score, item) => score + item.weight, 0), evidence);
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

const GROUP_RE = /([a-zA-Z_][\w]*)\s*:?=\s*([a-zA-Z_][\w]*)\s*\.\s*Group\s*\(\s*"([^"]+)"/g;

export class GinRouteScanner implements IRouteScanner {
  readonly framework = "gin" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "gin";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const out: ParsedRoute[] = [];
    const projectRoot = effectiveProjectRoot(match);
    // 1) main.go (if at root).
    const main = join(projectRoot, "main.go");
    if (existsSync(main)) {
      out.push(...(await parseGoFile(main, "main.go", projectRoot)));
    }
    // 2) cmd/, pkg/, internal/, src/ — recursive.
    await findAllGoFiles(projectRoot).then(async (files) => {
      for (const f of files) {
        const rel = f.startsWith(projectRoot)
          ? f.slice(projectRoot.length + 1).split("/").join("/")
          : f;
        // Avoid duplicating root main.go.
        if (rel === "main.go") continue;
        out.push(...(await parseGoFile(f, rel, projectRoot)));
      }
    });
    return { routes: out };
  }
}


/**
 * Recursively finds all `.go` files in the project (returns paths only).
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
  // Without this, a commented-out route ended up in the user's
  // collection. Go shares JS/TS comment syntax.
  const raw = stripJsComments(source);

  // 1) Detect Group prefixes.
  //
  // a00011 C-8: groups nest as a graph. The canonical shape:
  //
  //   api := r.Group("/api")
  //   users := api.Group("/users")     // ← the receiver of THIS group
  //   users.GET("/list", h)            //   is ANOTHER group, not the root
  //
  // GROUP_RE captures the receiver (`users`) and the emitter (`api`).
  // Resolving a group's prefix means walking up the chain of emitters
  // until reaching the root (`r`), concatenating prefixes along the
  // way. Before we only looked at the literal prefix of the group
  // itself, so `/api/users/list` came out as `/users/list`.
  const groupPrefix = new Map<string, string>();
  /** Who emits each group (`users` → `api`). */
  const groupParent = new Map<string, string>();
  let m: RegExpExecArray | null;
  const groupRe = ownRegex(GROUP_RE);
  while ((m = groupRe.exec(raw)) !== null) {
    const ident = m[1] ?? "";
    const emitter = m[2] ?? "";
    const prefix = m[3] ?? "";
    groupPrefix.set(ident, prefix);
    groupParent.set(ident, emitter);
  }

  /**
   * Prefijo completo de un grupo, subiendo por la cadena de padres.
   * Un guard de profundidad evita el ciclo imposible (`a := a.Group`)
   * that a broken source could declare.
   */
  const resolveGroupPrefix = (ident: string): string => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = ident;
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      const own = groupPrefix.get(current);
      if (own !== undefined) parts.unshift(own);
      current = groupParent.get(current);
    }
    return joinRoutePath(...parts);
  };

  // 2) Look for routes.
  const routeRe = ownRegex(ROUTE_RE);
  while ((m = routeRe.exec(raw)) !== null) {
    const ident = m[1] ?? "";
    const method = (m[2] ?? "").toLowerCase();
    const path = m[3] ?? "";
    if (!HTTP_METHODS.includes(method)) continue;
    const prefix = groupPrefix.has(ident) ? resolveGroupPrefix(ident) : "";
    const fullPath = joinRoutePath(prefix, path);
    out.push({
      method: method.toUpperCase(),
      uri: fullPath,
      rawUri: path,
      sourceFile: relPath,
      lineNumber: 0,
      prefixChain: prefix ? prefix.split("/") : [],
      displayName: `${method.toUpperCase()} ${path}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation spec provider (no-op for now; bodies via inference)
// ---------------------------------------------------------------------------

export class GinBindingProvider implements IValidationSpecProvider {
  readonly framework = "gin" as const;

  async supports(
    route: ParsedRoute,
    match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<boolean> {
    if (match.framework !== "gin") return false;
    // Look for .go files in the project that may contain structs.
    return route.sourceFile !== undefined;
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<{ endpointKey: string; fields: IValidationSpec[] }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    if (!route.sourceFile) return { endpointKey, fields: [] };
    const abs = join(rawProjectRoot(match), route.sourceFile);
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      return { endpointKey, fields: [] };
    }
    let fields = parseGoStructs(raw, route.uri);
    if (fields.length === 0) {
      // Fallback: buscar structs en otros archivos .go del proyecto.
      const files = await findAllGoFiles(effectiveProjectRoot(match));
      // Filter files whose name suggests relevance to the URI.
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
    // Only apply to methods that accept a body (POST/PUT/PATCH).
    if (!["POST", "PUT", "PATCH"].includes(route.method.toUpperCase())) {
      return { endpointKey, fields: [] };
    }
    const bodySpecs = fields.map((f) => ({ ...f, location: "body" as const }));
    return { endpointKey, fields: bodySpecs };
  }
}

/**
 * Parses Go structs from the file and extracts fields with binding tags.
 * Strategy: find `type X struct { ... }` and for each field capture
 * the `binding:"..."` tag.
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
  // Regex: `type X struct {` with capture of the body and name.
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
  // If there is only one struct → use that.
  if (structMap.length === 1) return structMap[0]!.fields;
  // If there are several and we have a URI, try to match the struct
  // name against words from the last segment of the path (or the full path).
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
    // Match by any word of the path: /api/users/{id}/address
    // → look for struct containing "User", "Address", "Users", etc.
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
  // If there are several → use the smallest (heuristic: minimum payload).
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
    // Heuristic: if the name has "id", "count", "age", "amount" → number.
    if (/id|count|age|amount|number|num$/i.test(fieldName)) return "integer";
    return "string";
  }
  if (binding.includes("gte=") || binding.includes("lte=") || binding.includes("gt=") || binding.includes("lt=")) {
    return "integer";
  }
  return "string";
}
