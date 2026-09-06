/**
 * `NestJsScanner` — implementation of `IProjectScanner` + `IRouteScanner`
 * for NestJS projects (Node.js + TypeScript).
 *
 * Detection:
 *   - `package.json` with `dependencies` containing `@nestjs/core`.
 *   - `nest-cli.json` (heuristic).
 *
 * Parsing:
 *   - Decorators `@Controller('path')` (class) + `@Get()`, `@Post()`, ...
 *     (method). Captures the controller's prefix and the specific path.
 *   - Supports paths with `:id` → `:p` (normalised later).
 *
 * Validation:
 *   - `NestJsClassValidatorProvider` extracts `class-validator` constraints
 *     from DTOs (`@IsString`, `@IsEmail`, `@IsInt`, `@IsOptional`, …).
 *   - If `class-transformer` or `class-validator` are present, those
 *     are the dependencies.
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { ownRegex } from "../../core/helpers/regex.helper.js";
import { readFile, readdir } from "node:fs/promises";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import { declaredDependencies, parseJson } from "../../core/helpers/parse-json.helper.js";
import { join } from "node:path";
import { effectiveProjectRoot, rawProjectRoot } from "../../core/discovery/effective-project-root.helper.js";
import { parseModule } from "../../core/language-frontends/typescript/index.js";
import type { TSDecorator } from "../../contracts/interfaces/core/language/typescript-frontend.interface.js";
import type { IParseDiagnostic, IProjectMatch, IProjectScanner, IRouteScanner, IScanResult, IValidationSpec, IValidationSpecProvider, ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"];

/**
 * Reads package.json and returns true if it has `@nestjs/core` in
 * dependencies or devDependencies.
 */
async function isNestJsProject(projectRoot: string): Promise<boolean> {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return false;
  let raw: string;
  try {
    raw = await readFile(pkgPath, "utf8");
  } catch {
    return false;
  }
  const parsed = parseJson(raw);
  if (!parsed.ok) return false;
  // `declaredDependencies` merges `dependencies` and `devDependencies`,
  // which is the real question: a framework declared in devDeps is
  // still the project's framework. Some scanners looked at them and
  // others didn't.
  const deps = declaredDependencies(parsed.value);
  return typeof deps["@nestjs/core"] === "string";
}

/**
 * Returns the effective root where this scanner looks at `src/`.
 *
 * If `IProjectMatch` carries `frameworkSearchRoot` (filled by the host
 * after monorepo detection), it's joined with `projectRoot`. If absent,
 * `projectRoot` is returned unchanged.
 *
 * Renamed locally (`nestjsEffectiveSearchRoot`) so it doesn't clash
 * with the homonym in `nextjs.scanner.ts`: each scanner has its own
 * implementation because each needs a different search root — here,
 * just `src/`; in nextjs, `app/` and `pages/`. f00011 S1.
 *
 * a00014 S2: now delegated to `effectiveProjectRoot(match)` from
 * `packages/core/discovery/effective-project-root.helper.ts`, the
 * single primitive all 21 scanners use. The local helper is kept as
 * a historic no-op so external call sites don't break, but the scanner
 * no longer uses it.
 */
function nestjsEffectiveSearchRoot(match: IProjectMatch): string {
  return effectiveProjectRoot(match);
}

/**
 * Lockfiles present in `projectRoot` as bonus runtime signals.
 *
 * f00011 S4: `pnpm-lock.yaml` and Bun lockfiles refine the detector's
 * confidence without being detection. Small weights: +0.1 (pnpm),
 * +0.15 (bun). It lives here — same as `nestjsEffectiveSearchRoot` —
 * because each scanner decides what to do with the signal. The cap at
 * 1 that `withEvidence` applies absorbs the case of a NestJS that
 * without this already scored at the top.
 *
 * x00035 S1: Bun ≥ 1.2 emits `bun.lock` (text) and Bun < 1.2 emits
 * `bun.lockb` (binary). Both are accepted; if both are present
 * (degenerate case, modern project with a stale binary lock), the
 * modern `bun.lock` wins and `bun.lockb` is ignored.
 */
function lockfileSignals(projectRoot: string): Array<{ signal: string; weight: number; artifact?: string }> {
  const out: Array<{ signal: string; weight: number; artifact?: string }> = [];
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) {
    out.push({ signal: "pnpm-lock.yaml presente", weight: 0.1, artifact: "pnpm-lock.yaml" });
  }
  if (existsSync(join(projectRoot, "bun.lock"))) {
    out.push({ signal: "bun.lock presente", weight: 0.15, artifact: "bun.lock" });
  } else if (existsSync(join(projectRoot, "bun.lockb"))) {
    out.push({ signal: "bun.lockb presente", weight: 0.15, artifact: "bun.lockb" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export class NestJsProjectScanner implements IProjectScanner {
  readonly framework = "nestjs" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const isNest = await isNestJsProject(projectRoot);
    if (!isNest) return emptyResult(0);
    const hasSrc = existsSync(join(projectRoot, "src"));
    const hasNestCli = existsSync(join(projectRoot, "nest-cli.json"));
    const signals: Array<{ signal: string; weight: number; artifact?: string }> = [
      { signal: "@nestjs/core declarado como dependencia", weight: 0.5, artifact: "package.json" },
    ];
    // f00011 S1: `nest-cli.json` is the canonical signal that the
    // project was initialised with the Nest CLI (not just a loose
    // dependency). Before it weighed 0.3; the proposal raises it to
    // 0.7 — closer to the weight of `@nestjs/core` itself, because a
    // project with CLI almost always has the expected layout.
    if (hasNestCli) signals.push({ signal: "nest-cli.json present", weight: 0.7, artifact: "nest-cli.json" });
    if (hasSrc) signals.push({ signal: "directorio src/ presente", weight: 0.2, artifact: "src/" });
    // f00011 S4: lockfile as runtime bonus. Added at the end so it
    // can't mask an absent framework.
    for (const lock of lockfileSignals(projectRoot)) signals.push(lock);
    return withEvidence(signals.reduce((a, s) => a + s.weight, 0), signals);
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const artifacts: string[] = ["package.json"];
    if (existsSync(join(projectRoot, "nest-cli.json"))) artifacts.push("nest-cli.json");
    if (existsSync(join(projectRoot, "src"))) artifacts.push("src");
    return { framework: "nestjs", projectRoot, artifacts };
  }
}

// ---------------------------------------------------------------------------
// Route scanner
// ---------------------------------------------------------------------------

/**
 * Decorator `@Controller(path)` on the class.
 * Allows compound prefixes: `@Controller({ path: 'users', version: '1' })`.
 */
const CLASS_CONTROLLER_RE = /@Controller\s*\(\s*(?:["']([^"']+)["']|\{[^}]*path\s*:\s*["']([^"']+)["'])[^)]*\)?/;

/**
 * Method decorators: `@Get()`, `@Get(':id')`, `@Get('/users/:id')`.
 */
const METHOD_DECORATOR_RE = /@(Get|Post|Put|Delete|Patch|Head|Options)\s*\(\s*(?:["']([^"']*)["'])?\s*\)/g;

export class NestJsRouteScanner implements IRouteScanner {
  readonly framework = "nestjs" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "nestjs";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    const out: ParsedRoute[] = [];
    // f00011 S1: in monorepos the host passes `frameworkSearchRoot`
    // (e.g. `"apps/api"`) and the scanner looks there. Without this,
    // a NestJS project in `apps/api/` came out without routes because
    // `src/` lives in the subdir. The root stays in `match.projectRoot`
    // so `setGlobalPrefix` is still searched where the orchestrator
    // left it.
    const searchRoot = nestjsEffectiveSearchRoot(match);
    const srcDir = join(searchRoot, "src");
    if (!existsSync(srcDir)) return { routes: out };
    await this.walkDir(srcDir, searchRoot, out);

    // `app.setGlobalPrefix("api/v1")` in the bootstrap is applied to ALL
    // controllers. Without this, a project that uses it —the norm in
    // NestJS— produces URIs without the prefix and no request responds.
    //
    // Audit 2026-09-04 P2 #3: we try the `searchRoot` first (where the
    // bootstrap lives in monorepos `apps/api`) and then `projectRoot`
    // (flat layout where `main.ts` is at the root). Before we only
    // looked at `projectRoot`, so a Nest in `apps/api` came out
    // without the prefix.
    const globalPrefix = await readGlobalPrefix(
      searchRoot,
      rawProjectRoot(match),
    );
    if (!globalPrefix) return { routes: out };

    return { routes: out.map((route) => ({
      ...route,
      uri: joinRoutePath("/", globalPrefix, route.uri),
      prefixChain: [globalPrefix, ...route.prefixChain],
    })) };
  }

  private async walkDir(
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
      if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
        const rel = full.startsWith(projectRoot)
          ? full.slice(projectRoot.length + 1).split("/").join("/")
          : full;
        out.push(...(await this.parseControllerFile(full, rel)));
      } else if (!entry.includes(".")) {
        await this.walkDir(full, projectRoot, out);
      }
    }
  }

  private async parseControllerFile(
    absPath: string,
    relPath: string,
  ): Promise<ParsedRoute[]> {
    let raw: string;
    try {
      raw = await readFile(absPath, "utf8");
    } catch {
      return [];
    }
    // Un diagnóstico de parseo no se propaga: el fallback regex de
    // abajo cubre el fichero roto. La degradación es silenciosa por
    // diseño (mismo contrato que Express).
    const diagnostics: Array<IParseDiagnostic> = [];
    const ast = parseModule(raw, absPath, diagnostics);
    // x00048 S4: AST real (decorators del frontend TS). Si el parse
    // falla (sintaxis que Babel no digiere), degradamos al fallback
    // regex legacy de más abajo — el scan no aborta nunca.
    if (ast) return routesFromDecorators(ast.decorators, relPath);

    // --- Fallback legacy (sólo texto no parseable) --------------------
    const out: ParsedRoute[] = [];
    const text = stripJsComments(raw);
    const lines = text.split("\n");

    // 1) Look for `@Controller('path')` in the first half of the file.
    let controllerPath = "";
    let controllerMatchIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const m = CLASS_CONTROLLER_RE.exec(line);
      if (m) {
        controllerPath = m[1] ?? m[2] ?? "";
        controllerMatchIndex = i;
        break;
      }
    }
    if (controllerMatchIndex === -1) return out; // No es un controller.

    // 2) Look for method decorators `@METHOD('path')` AFTER the controller.
    for (let i = controllerMatchIndex + 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      let m: RegExpExecArray | null;
      const methodDecoratorRe = ownRegex(METHOD_DECORATOR_RE);
      while ((m = methodDecoratorRe.exec(line)) !== null) {
        const method = (m[1] ?? "").toLowerCase();
        const subPath = m[2] ?? "";
        if (!HTTP_METHODS.includes(method)) continue;
        const fullPath = joinRoutePath("/", controllerPath, subPath);
        // Look for the method signature in the next lines.
        let methodName = "";
        for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
          const sig = /\b([a-zA-Z_][\w]*)\s*\(/.exec(lines[j] ?? "");
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
          prefixChain: controllerPath ? [controllerPath] : [],
          displayName: methodName || `${method.toUpperCase()} ${fullPath}`,
          ...(methodName ? { description: methodName } : {}),
        });
      }
    }
    return out;
  }
}

/**
 * Convierte los decoradores del frontend TS en `ParsedRoute[]`
 * (x00048 S4). Cubre:
 *
 *   - `@Controller('users')` y `@Controller({ path: 'users' })` en la
 *     clase → prefijo del controller.
 *   - `@Get()`, `@Get(':id')`, `@Post('items')`… en los métodos →
 *     una ruta por decorador, con el prefijo del controller aplicado.
 *
 * `target` es el nombre del símbolo decorado: la clase para
 * `@Controller`, el método para los verbos. `line` viene del
 * decorador en el fuente (mejor que la heurística de "3 líneas
 * después" del fallback regex).
 *
 * Un archivo SIN `@Controller` no es un controller: devuelve []
 * (igual que la ruta legacy).
 */
function routesFromDecorators(
  decorators: ReadonlyArray<TSDecorator>,
  relPath: string,
): ParsedRoute[] {
  // 1) Prefijo del controller.
  let controllerPath = "";
  let hasController = false;
  for (const dec of decorators) {
    if (dec.name !== "Controller") continue;
    hasController = true;
    controllerPath = controllerPathFromArgs(dec);
    break;
  }
  if (!hasController) return [];

  // 2) Decoradores de verbo HTTP sobre métodos.
  const out: ParsedRoute[] = [];
  for (const dec of decorators) {
    const method = dec.name.toLowerCase();
    if (!HTTP_METHODS.includes(method)) continue;
    const fullPath = joinRoutePath("/", controllerPath, stringArgOf(dec));
    const methodName = dec.target;
    out.push({
      method: method.toUpperCase(),
      uri: fullPath,
      rawUri: fullPath,
      sourceFile: relPath,
      lineNumber: dec.line,
      prefixChain: controllerPath ? [controllerPath] : [],
      displayName: methodName || `${method.toUpperCase()} ${fullPath}`,
      ...(methodName ? { description: methodName } : {}),
    });
  }
  return out;
}

/**
 * Path del `@Controller`: primer argumento string, o el campo `path`
 * del objeto (`@Controller({ path: 'users', version: '1' })`). La
 * forma objeto la cubre el frontend como `TSLiteral` con
 * `objectShape` (literalFromNode desciende a propiedades).
 */
function controllerPathFromArgs(dec: TSDecorator): string {
  const first = dec.args[0];
  if (!first) return "";
  if (first.kind === "string" && typeof first.value === "string") return first.value;
  if (first.kind === "object" && first.objectShape) {
    for (const prop of first.objectShape) {
      if (prop.key === "path" && prop.literal.kind === "string" && typeof prop.literal.value === "string") {
        return prop.literal.value;
      }
    }
  }
  return "";
}

/** Primer argumento string del decorador (`@Get(':id')` → `":id"`). */
function stringArgOf(dec: TSDecorator): string {
  const first = dec.args[0];
  if (first?.kind === "string" && typeof first.value === "string") return first.value;
  return "";
}

/** `app.setGlobalPrefix("api/v1")` in the application's bootstrap. */
const GLOBAL_PREFIX_RE = /setGlobalPrefix\s*\(\s*["'`]([^"'`]+)["'`]/;

/**
 * Global prefix declared in the bootstrap, or `null` if there is none.
 *
 * `setGlobalPrefix` is applied to ALL controllers. Without reading it,
 * a project that uses it —the norm in NestJS— produced URIs without
 * the prefix and no request responded.
 *
 * Audit 2026-09-04 P2 #3 (Nest global prefix from searchRoot): before
 * we only looked at `match.projectRoot`. In a monorepo with
 * `frameworkSearchRoot: "apps/api"`, the `setGlobalPrefix` is in
 * `apps/api/src/main.ts` and the scanner couldn't find it: routes came
 * out without the global prefix. We now try the searchRoot first
 * (where `main.ts` lives in monorepos) and then projectRoot (flat
 * layout where `main.ts` is at the root).
 *
 * `roots` is the ordered list of candidates; the first match wins.
 */
async function readGlobalPrefix(
  ...roots: ReadonlyArray<string>
): Promise<string | null> {
  for (const projectRoot of roots) {
    for (const candidate of ["src/main.ts", "src/main.js", "main.ts"]) {
      const abs = join(projectRoot, candidate);
      if (!existsSync(abs)) continue;
      try {
        const match = GLOBAL_PREFIX_RE.exec(
          stripJsComments(await readFile(abs, "utf8")),
        );
        if (match?.[1]) return match[1];
      } catch {
        continue;
      }
    }
  }
  return null;
}

function stripJsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------
// Validation spec provider — class-validator
// ---------------------------------------------------------------------------

const VALIDATOR_MAP: Record<string, { type: IValidationSpec["type"]; format?: string }> = {
  IsString: { type: "string" },
  IsInt: { type: "integer" },
  IsNumber: { type: "number" },
  IsBoolean: { type: "boolean" },
  IsDate: { type: "date" },
  IsArray: { type: "array" },
  IsObject: { type: "object" },
  IsEmail: { type: "string", format: "email" },
  IsUrl: { type: "string", format: "url" },
  IsUUID: { type: "string", format: "uuid" },
  IsEnum: { type: "enum" },
  IsNotEmpty: { type: "string" },
  IsDefined: { type: "string" },
  Min: { type: "integer" },
  Max: { type: "integer" },
  Length: { type: "string" },
  MinLength: { type: "string" },
  MaxLength: { type: "string" },
  IsOptional: { type: "string" },
  IsPositive: { type: "integer" },
  IsNegative: { type: "integer" },
};

export class NestJsClassValidatorProvider implements IValidationSpecProvider {
  readonly framework = "nestjs" as const;

  async supports(
    _r: ParsedRoute,
    _m: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<boolean> {
    return _m.framework === "nestjs" && Boolean(_r.description);
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
    _scanResult: IScanResult,
  ): Promise<{ endpointKey: string; fields: IValidationSpec[] }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    if (!route.sourceFile || !route.description) return { endpointKey, fields: [] };
    const abs = join(rawProjectRoot(match), route.sourceFile);
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      return { endpointKey, fields: [] };
    }
    const text = stripJsComments(raw);
    const lines = text.split("\n");

    // 1) Locate the method's signature (after the @Get/@Post).
    const sigIdx = lines.findIndex((l) =>
      new RegExp(`\\b${route.description}\\s*\\(`).test(l),
    );
    if (sigIdx < 0) return { endpointKey, fields: [] };

    // 2) Collect imports to resolve referenced DTOs.
    const imports = parseImports(text, abs);

    // 3) Detect `@Body() <name>: <DtoType>` in the signature line.
    const sigLine = lines[sigIdx] ?? "";
    let fields: IValidationSpec[] = [];
    const bodyMatch = /@Body\s*\(\s*\)\s*[\s\S]*?\s+([a-zA-Z_][\w]*)\s*:\s*([A-Z][\w]*)/.exec(sigLine);
    if (bodyMatch?.[2]) {
      const dtoTypeName = bodyMatch[2];
      const dtoPath = imports.get(dtoTypeName);
      fields = dtoPath
        ? await parseDtoFile(dtoPath, dtoTypeName)
        : // Without an import, the class is in this very file. That's
          // what half of Nest's docs teach and what anyone does in a
          // small project, and until now it ended up without a body.
          parseDtoSource(text, dtoTypeName);
      // An import pointing at a barrel (`./dto`) might not lead to the
      // class. If nothing came out, we look here too before giving up.
      if (fields.length === 0) fields = parseDtoSource(text, dtoTypeName);
    }

    // 4) The loose signature parameters: `@Query("page") page: number`,
    //    `@Param("id") id: string`, `@Headers("x-tenant") tenant: string`.
    //
    // This was a fallback with a regex that matched a decorator with
    // **any** field within the 9 lines above (`[\s\S]*?` between parts)
    // and marked it all as `body`. The result was that a `@Query("page")`
    // on a GET appeared documented as a body field, with the type of
    // the first `@IsString()` it caught above. A GET has no body, so the
    // collection asserted something impossible.
    fields.push(...parseSignatureParams(sigLine));

    return { endpointKey, fields };
  }
}

/**
 * The parameters NestJS injects by decorator in the signature.
 *
 * `@Query("page") page: number` is a query parameter, not a body
 * field, and the difference matters: a GET has no body, so
 * documenting it there describes a request that can't be made.
 *
 * `@Body()` doesn't enter: the DTO resolves it, and the DTO carries
 * much more information (mandatory, formats, bounds) than the
 * TypeScript type.
 */
const PARAM_DECORATORS: Readonly<Record<string, IValidationSpec["location"]>> = {
  Query: "query",
  Param: "path",
  Headers: "header",
};

/** TypeScript type → contract type. Anything not recognised, string. */
function tsTypeToSpecType(tsType: string): IValidationSpec["type"] {
  const t = tsType.trim().toLowerCase();
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  if (t === "date") return "date";
  if (t.endsWith("[]") || t.startsWith("array")) return "array";
  return "string";
}

function parseSignatureParams(sigLine: string): IValidationSpec[] {
  const out: IValidationSpec[] = [];
  // The decorator and its parameter sit together:
  // `@Query("page") page: number`. Without arbitrary whitespace
  // between parts we can't match a decorator with a field that
  // isn't its own.
  const re = /@(Query|Param|Headers)\s*\(\s*(?:["']([^"']+)["'])?\s*\)\s*([a-zA-Z_][\w]*)\s*\??\s*:\s*([a-zA-Z_][\w\[\]<>|]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sigLine)) !== null) {
    const location = PARAM_DECORATORS[m[1] ?? ""];
    if (!location) continue;
    // The name is set by the decorator argument (`@Query("page")`);
    // if it doesn't have one, by the variable's name.
    const fieldName = m[2] || m[3] || "";
    if (!fieldName) continue;
    out.push({
      fieldName,
      location,
      type: tsTypeToSpecType(m[4] ?? ""),
      // A `?` in the signature is optional; the rest is assumed
      // required, which is NestJS's default.
      required: !new RegExp(`\\b${m[3]}\\s*\\?\\s*:`).test(sigLine),
    });
  }
  return out;
}

/**
 * Parses all imports in the controller's file and returns a map
 * `TypeName → absolute path of the DTO file`.
 */
function parseImports(text: string, controllerAbsPath: string): Map<string, string> {
  const out = new Map<string, string>();
  const dir = controllerAbsPath.replace(/[^/\\]+$/, "");
  // Match: `import { Foo, Bar } from "./path"` or `import { Foo } from "../path"`.
  const importRe = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(text)) !== null) {
    const names = (m[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const relPath = m[2] ?? "";
    if (!relPath.startsWith(".")) continue; // Skip npm packages.
    // Resolve to .ts file. Assume `.ts` extension or `.dto.ts`.
    const candidates = [
      join(dir, relPath) + ".ts",
      join(dir, relPath, "index.ts"),
      join(dir, relPath) + "/index.ts",
    ];
    const absPath = candidates.find((candidate) => existsSync(candidate)) ?? null;
    if (!absPath) continue;
    for (const name of names) {
      out.set(name, absPath);
    }
  }
  return out;
}

/**
 * Reads a DTO file and returns the fields of class `dtoTypeName`.
 */
async function parseDtoFile(
  dtoPath: string,
  dtoTypeName: string,
): Promise<IValidationSpec[]> {
  let raw: string;
  try {
    raw = await readFile(dtoPath, "utf8");
  } catch {
    return [];
  }
  return parseDtoSource(stripJsComments(raw), dtoTypeName);
}

/**
 * The fields of a DTO class, looking for it inside a source already
 * read.
 *
 * This is separate from `parseDtoFile` because the DTO **isn't always
 * in another file**. A NestJS controller with its `class CreateUserDto`
 * declared above — what half of Nest's docs teach and what anyone does
 * in a small project — doesn't import anything, so the import-based
 * resolution didn't find the class and the endpoint came out without a
 * body. The previous fallback only looked at the 8 lines right above
 * the signature, where the class isn't.
 *
 * `source` must already have comments stripped.
 */
function parseDtoSource(text: string, dtoTypeName: string): IValidationSpec[] {
  const lines = text.split("\n");

  // 1) Find the `export class <dtoTypeName>` line.
  const classIdx = lines.findIndex((l) =>
    new RegExp(`\\b(?:export\\s+)?class\\s+${dtoTypeName}\\b`).test(l),
  );
  if (classIdx < 0) return [];

  // 2) Collect lines from classIdx until the class's closing `}`.
  const fields: IValidationSpec[] = [];
  let braceDepth = 0;
  let started = false;
  // Buffer of `@IsXxx(args)` decorators before the field.
  let pendingDecorators: Array<{ decorator: string; args: string }> = [];
  for (let i = classIdx; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (i === classIdx) {
      // Find the first `{` to start.
      for (const c of line) {
        if (c === "{") {
          braceDepth++;
          started = true;
          break;
        }
      }
      continue;
    }
    for (const c of line) {
      if (c === "{") braceDepth++;
      else if (c === "}") braceDepth--;
    }
    if (started && braceDepth <= 0) break;

    // 3) If the line has only decorators (`@Decorator()` or
    //    `@Decorator(args)`), add them to the buffer.
    const decOnly = line.match(/^\s*@([A-Z]\w*)\s*(?:\(([^)]*)\))?\s*$/);
    if (decOnly) {
      const decName = decOnly[1] ?? "";
      const decArgs = decOnly[2] ?? "";
      if (decName !== "Type") {
        pendingDecorators.push({ decorator: decName, args: decArgs });
      }
      continue;
    }

    // 4) If the line has `field: type`, `field!: type` or `field?: type`,
    //    consume the buffer and emit the fields.
    //
    // The pattern was `(?:!|:)\s*:`, which required TWO colons: `field!:`
    // or `field::`. A normal `name: string` — the way 99% of DTOs are
    // declared — never matched, so the NestJS DTO parser pulled no
    // field at all, either from a separate file or from the same class.
    // The `?` for optional fields wasn't covered either.
    const fm = /^[\s\S]*?([a-zA-Z_][\w]*)\s*[!?]?\s*:\s*([a-zA-Z_][\w\[\]<>,\s|"']*)/.exec(line);
    if (!fm || pendingDecorators.length === 0) {
      // Not a field line; clear the buffer.
      if (line.trim().length > 0 && !line.match(/^[\s,;]+$/)) {
        pendingDecorators = [];
      }
      continue;
    }
    const fieldName = fm[1] ?? "";
    const fieldType = (fm[2] ?? "").trim();

    // One field, one spec.
    //
    // This emitted **one spec per decorator**, so
    // `@IsString() @MinLength(1) @MaxLength(100) name: string` produced
    // three fields called `name` — each with a slice of the
    // information and none with all of it — and the example body came
    // out with the same key repeated. Now the decorators of a field
    // are merged into the same spec, which is what they are: different
    // constraints on one thing.
    const field: IValidationSpec = {
      fieldName,
      location: "body",
      type: "string",
      // `@IsOptional()` can come before or after the rest, so we decide
      // by looking at all the field's decorators, not just the current one.
      required: !pendingDecorators.some((d) => d.decorator === "IsOptional"),
    };
    let recognised = false;

    for (const { decorator, args } of pendingDecorators) {
      const map = VALIDATOR_MAP[decorator];
      if (!map) continue;
      recognised = true;
      // `IsOptional` only speaks about required-ness, already resolved
      // above: it must not overwrite the type declared by `@IsInt()` or
      // `@IsEmail()`.
      if (decorator !== "IsOptional") {
        field.type = map.type;
        if (map.format) field.format = map.format;
      }
      // Enum.
      if (decorator === "IsEnum") {
        const values = args.match(/\[([^\]]+)\]/);
        if (values?.[1]) {
          field.enumValues = values[1]
            .split(",")
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
            .filter(Boolean);
        }
      }
      // Length. class-validator arguments are POSITIONAL:
      // `@MinLength(1)`, `@MaxLength(100)`, `@Length(1, 100)`.
      //
      // This looked for `min: 1` / `max: 100`, a named shape
      // class-validator doesn't have and which isn't even valid
      // TypeScript as a bare argument. None of the three ever got its
      // value out: the field came out without bounds and nobody
      // noticed.
      if (decorator === "Length" || decorator === "MinLength" || decorator === "MaxLength") {
        const numbers = [...args.matchAll(/\d+/g)].map((m) => Number(m[0]));
        if (decorator === "MinLength" && numbers[0] !== undefined) {
          field.minLength = numbers[0];
        }
        if (decorator === "MaxLength" && numbers[0] !== undefined) {
          field.maxLength = numbers[0];
        }
        if (decorator === "Length") {
          // `@Length(min)` and `@Length(min, max)`.
          if (numbers[0] !== undefined) field.minLength = numbers[0];
          if (numbers[1] !== undefined) field.maxLength = numbers[1];
        }
      }
      // Min/Max.
      if (decorator === "Min" || decorator === "Max") {
        const v = /(\d+)/.exec(args);
        if (v?.[1]) {
          if (decorator === "Min") field.minimum = Number(v[1]);
          else field.maximum = Number(v[1]);
        }
      }
    }
    // Without any class-validator decorator, it's not a validated field:
    // it's just any class property.
    if (recognised) fields.push(field);
    pendingDecorators = [];
    void fieldType; // unused but useful for type-aware rules
  }
  return fields;
}
