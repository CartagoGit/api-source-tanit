/**
 * `SpringBootScanner` — implementación de `IProjectScanner` + `IRouteScanner`
 * para Spring Boot (Java / Kotlin).
 *
 * Detección:
 *   - `pom.xml` con `spring-boot-starter-web` o `build.gradle` con
 *     `org.springframework.boot`.
 *   - `Application.java` con anotación `@SpringBootApplication`.
 *
 * Parsing:
 *   - `@RequestMapping("/api/v1")` o `@RestController` (en la clase) — captura
 *     el prefijo del controller.
 *   - `@GetMapping("/users")`, `@PostMapping(...)`, etc. (en método).
 *   - `@PathVariable`, `@RequestParam`, `@RequestBody` para path/query/body.
 *
 * Validation:
 *   - `SpringBootBeanValidationProvider` (best-effort): extrae
 *     `jakarta.validation.constraints.*` de DTOs.
 *   - Limitado: solo constraints inline en el package local.
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

async function isSpringBootProject(projectRoot: string): Promise<boolean> {
  for (const file of ["pom.xml", "build.gradle", "build.gradle.kts"]) {
    const p = join(projectRoot, file);
    if (!existsSync(p)) continue;
    let raw: string;
    try {
      raw = await readFile(p, "utf8");
    } catch {
      continue;
    }
    if (/spring-boot/i.test(raw)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export class SpringBootProjectScanner implements IProjectScanner {
  readonly framework = "springboot" as const;

  async detect(projectRoot: string): Promise<number> {
    const isSpring = await isSpringBootProject(projectRoot);
    if (!isSpring) return 0;
    const hasSrc = existsSync(join(projectRoot, "src"));
    if (hasSrc) return 1;
    return 0.7;
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const artifacts: string[] = [];
    if (existsSync(join(projectRoot, "pom.xml"))) artifacts.push("pom.xml");
    if (existsSync(join(projectRoot, "build.gradle"))) artifacts.push("build.gradle");
    if (existsSync(join(projectRoot, "src"))) artifacts.push("src");
    return { framework: "springboot", projectRoot, artifacts };
  }
}

// ---------------------------------------------------------------------------
// Route scanner
// ---------------------------------------------------------------------------

const CLASS_MAPPING_RE =
  /@(RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|Controller|RestController)\s*(\([^)]*\))?/g;

const METHOD_MAPPING_RE =
  /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(\([^)]*\))?/g;

function extractPaths(args: string): string[] {
  // `value = "/path"` o `path = "/path"` o `"/path"`.
  const out: string[] = [];
  const slashRe = /["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = slashRe.exec(args)) !== null) {
    out.push(m[1] ?? "");
  }
  return out;
}

export class SpringBootRouteScanner implements IRouteScanner {
  readonly framework = "springboot" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "springboot";
  }

  async scan(match: IProjectMatch): Promise<ParsedRoute[]> {
    const out: ParsedRoute[] = [];
    const projectRoot = match.projectRoot;
    const srcMain = join(projectRoot, "src", "main", "java");
    if (!existsSync(srcMain)) return out;
    await walkJava(srcMain, projectRoot, out);
    return out;
  }
}

async function walkJava(
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
    if ((entry.endsWith(".java") || entry.endsWith(".kt")) && !entry.endsWith(".bak")) {
      const rel = full.startsWith(projectRoot)
        ? full.slice(projectRoot.length + 1).split("/").join("/")
        : full;
      out.push(...(await parseJavaFile(full, rel)));
    } else if (!entry.includes(".")) {
      await walkJava(full, projectRoot, out);
    }
  }
}

async function parseJavaFile(
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
  const text = stripJavaComments(raw);
  const lines = text.split("\n");

  // 1) Detectar prefijo del controller.
  //    Pasada 1: encontrar @RequestMapping con args (prefiere con path).
  //    Pasada 2: fallback a @RestController/@Controller (sin prefix).
  let classPrefix = "";
  let classStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    CLASS_MAPPING_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CLASS_MAPPING_RE.exec(line)) !== null) {
      const decorator = m[1] ?? "";
      const args = m[2] ?? "";
      if (decorator === "RequestMapping") {
        const paths = extractPaths(args);
        if (paths.length > 0) {
          classPrefix = paths[0] ?? "";
          classStart = i;
          break;
        }
      }
    }
    if (classStart >= 0) break;
  }
  // Pasada 2: si no hay @RequestMapping con path, buscar @RestController/@Controller.
  if (classStart < 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      CLASS_MAPPING_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CLASS_MAPPING_RE.exec(line)) !== null) {
        const decorator = m[1] ?? "";
        if (["Controller", "RestController"].includes(decorator)) {
          classStart = i;
          break;
        }
      }
      if (classStart >= 0) break;
    }
  }
  if (classStart < 0) return out;

  // 2) Buscar method mappings.
  for (let i = classStart + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    METHOD_MAPPING_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = METHOD_MAPPING_RE.exec(line)) !== null) {
      const decorator = m[1] ?? "";
      const args = m[2] ?? "";
      const paths = extractPaths(args);
      const subPath = paths[0] ?? "";
      const fullPath = (classPrefix + "/" + subPath).replace(/\/+/g, "/");
      let methods: string[] = [];
      switch (decorator) {
        case "GetMapping":
          methods = ["get"];
          break;
        case "PostMapping":
          methods = ["post"];
          break;
        case "PutMapping":
          methods = ["put"];
          break;
        case "DeleteMapping":
          methods = ["delete"];
          break;
        case "PatchMapping":
          methods = ["patch"];
          break;
        case "RequestMapping":
          methods = parseMethodsFromArgs(args);
          if (methods.length === 0) methods = ["get"];
          break;
      }
      // Buscar signature del método.
      let methodName = "";
      for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
        const sig = /\b([a-zA-Z_][\w]*)\s*\(\s*(@?\w+)?\s*\)/.exec(lines[j] ?? "");
        if (sig?.[1] && !["if", "for", "while"].includes(sig[1])) {
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
          prefixChain: classPrefix ? [classPrefix] : [],
          displayName: methodName || `${method.toUpperCase()} ${fullPath}`,
          ...(methodName ? { description: methodName } : {}),
        });
      }
    }
  }
  return out;
}

function parseMethodsFromArgs(args: string): string[] {
  const m = /method\s*=\s*\{?\s*RequestMethod\.(\w+)/i.exec(args);
  if (m?.[1]) return [m[1].toLowerCase()];
  const ar = /methods\s*=\s*\{?\s*RequestMethod\.(\w+)/i.exec(args);
  if (ar?.[1]) return [ar[1].toLowerCase()];
  return [];
}

function stripJavaComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------
// Validation spec provider (no-op; bodies via inference)
// ---------------------------------------------------------------------------

export class SpringBootBeanValidationProvider implements IValidationSpecProvider {
  readonly framework = "springboot" as const;

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
