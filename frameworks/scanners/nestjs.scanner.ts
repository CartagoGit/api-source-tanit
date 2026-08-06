/**
 * `NestJsScanner` — implementación de `IProjectScanner` + `IRouteScanner`
 * para proyectos NestJS (Node.js + TypeScript).
 *
 * Detección:
 *   - `package.json` con `dependencies` que contenga `@nestjs/core`.
 *   - `nest-cli.json` (heurístico).
 *
 * Parsing:
 *   - Decoradores `@Controller('path')` (clase) + `@Get()`, `@Post()`, ...
 *     (método). Captura el prefijo del controller y el path específico.
 *   - Soporta paths con `:id` → `:p` (se normaliza más adelante).
 *
 * Validation:
 *   - `NestJsClassValidatorProvider` extrae constraints de `class-validator`
 *     de los DTOs (`@IsString`, `@IsEmail`, `@IsInt`, `@IsOptional`, …).
 *   - Si hay `class-transformer` o `class-validator`, son las dependencias.
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { joinRoutePath } from "../../helpers/uri.helper.js";
import { join } from "node:path";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contracts/scanner.interface.js";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"];

/**
 * Lee package.json y devuelve true si tiene `@nestjs/core` en
 * dependencies o devDependencies.
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
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  const deps = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
  return typeof deps["@nestjs/core"] === "string";
}

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------

export class NestJsProjectScanner implements IProjectScanner {
  readonly framework = "nestjs" as const;

  async detect(projectRoot: string): Promise<number> {
    const isNest = await isNestJsProject(projectRoot);
    if (!isNest) return 0;
    const hasSrc = existsSync(join(projectRoot, "src"));
    const hasNestCli = existsSync(join(projectRoot, "nest-cli.json"));
    if (hasSrc && hasNestCli) return 1;
    if (hasSrc) return 0.8;
    return 0.5;
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
 * Decorator `@Controller(path)` en la clase.
 * Permite prefijos múltiples: `@Controller({ path: 'users', version: '1' })`.
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

  async scan(match: IProjectMatch): Promise<ParsedRoute[]> {
    const out: ParsedRoute[] = [];
    const srcDir = join(match.projectRoot, "src");
    if (!existsSync(srcDir)) return out;
    await this.walkDir(srcDir, match.projectRoot, out);

    // `app.setGlobalPrefix("api/v1")` en el bootstrap se aplica a TODOS
    // los controladores. Sin esto, un proyecto que lo use —lo normal en
    // NestJS— produce URIs sin el prefijo y ninguna request responde.
    const globalPrefix = await readGlobalPrefix(match.projectRoot);
    if (!globalPrefix) return out;

    return out.map((route) => ({
      ...route,
      uri: joinRoutePath("/", globalPrefix, route.uri),
      prefixChain: [globalPrefix, ...route.prefixChain],
    }));
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
    const out: ParsedRoute[] = [];
    let raw: string;
    try {
      raw = await readFile(absPath, "utf8");
    } catch {
      return [];
    }
    const text = stripJsComments(raw);
    const lines = text.split("\n");

    // 1) Buscar `@Controller('path')` en la primera mitad del archivo.
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

    // 2) Buscar method decorators `@METHOD('path')` DESPUÉS del controller.
    METHOD_DECORATOR_RE.lastIndex = 0;
    for (let i = controllerMatchIndex + 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      METHOD_DECORATOR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = METHOD_DECORATOR_RE.exec(line)) !== null) {
        const method = (m[1] ?? "").toLowerCase();
        const subPath = m[2] ?? "";
        if (!HTTP_METHODS.includes(method)) continue;
        const fullPath = joinRoutePath("/", controllerPath, subPath);
        // Buscar la signature del método en líneas siguientes.
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

/** `app.setGlobalPrefix("api/v1")` en el arranque de la aplicación. */
const GLOBAL_PREFIX_RE = /setGlobalPrefix\s*\(\s*["'`]([^"'`]+)["'`]/;

/**
 * Prefijo global declarado en el bootstrap, o `null` si no hay.
 *
 * `setGlobalPrefix` se aplica a TODOS los controladores. Sin leerlo, un
 * proyecto que lo use —lo normal en NestJS— producía URIs sin el prefijo
 * y ninguna request respondía.
 */
async function readGlobalPrefix(projectRoot: string): Promise<string | null> {
  for (const candidate of ["src/main.ts", "src/main.js", "main.ts"]) {
    const abs = join(projectRoot, candidate);
    if (!existsSync(abs)) continue;
    try {
      const match = GLOBAL_PREFIX_RE.exec(stripJsComments(await readFile(abs, "utf8")));
      if (match?.[1]) return match[1];
    } catch {
      continue;
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

interface ValidatorField {
  name: string;
  type: IValidationSpec["type"];
  required: boolean;
  format?: string;
  enumValues?: string[];
  min?: number;
  max?: number;
}

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

const DECORATOR_RE = /@(Is\w+|MinLength|MaxLength|Length|Min|Max|IsOptional|IsPositive|IsNegative|IsDefined|IsNotEmpty)\s*\(([^)]*)\)/g;

export class NestJsClassValidatorProvider implements IValidationSpecProvider {
  readonly framework = "nestjs" as const;

  async supports(_r: ParsedRoute, _m: IProjectMatch): Promise<boolean> {
    return _m.framework === "nestjs" && Boolean(_r.description);
  }

  async resolve(
    route: ParsedRoute,
    match: IProjectMatch,
  ): Promise<{ endpointKey: string; fields: IValidationSpec[] }> {
    const endpointKey = `${route.method} ${route.uri}`.toLowerCase();
    if (!route.sourceFile || !route.description) return { endpointKey, fields: [] };
    const abs = join(match.projectRoot, route.sourceFile);
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      return { endpointKey, fields: [] };
    }
    const text = stripJsComments(raw);
    const lines = text.split("\n");

    // 1) Localizar la firma del método (después del @Get/@Post).
    const sigIdx = lines.findIndex((l) =>
      new RegExp(`\\b${route.description}\\s*\\(`).test(l),
    );
    if (sigIdx < 0) return { endpointKey, fields: [] };

    // 2) Recoger imports para resolver DTOs referenciados.
    const imports = parseImports(text, abs);

    // 3) Detectar `@Body() <name>: <DtoType>` en la línea de la signature.
    const sigLine = lines[sigIdx] ?? "";
    let fields: IValidationSpec[] = [];
    const bodyMatch = /@Body\s*\(\s*\)\s*[\s\S]*?\s+([a-zA-Z_][\w]*)\s*:\s*([A-Z][\w]*)/.exec(sigLine);
    if (bodyMatch?.[2]) {
      const dtoTypeName = bodyMatch[2];
      const dtoPath = imports.get(dtoTypeName);
      if (dtoPath) {
        fields = await parseDtoFile(dtoPath, dtoTypeName);
      }
    }

    // 4) Fallback: buscar `@IsXxx() field: type` inline en el handler.
    if (fields.length === 0) {
      const tail = lines.slice(Math.max(0, sigIdx - 8), sigIdx + 1).join("\n");
      const fieldRe = /@([A-Z]\w*)\s*(?:\(([^)]*)\))?\s*(?:[\s\S]*?)\s*([a-zA-Z_][\w]*)\s*:\s*([a-zA-Z_][\w\[\]<>,\s|"']*)/g;
      let m: RegExpExecArray | null;
      while ((m = fieldRe.exec(tail)) !== null) {
        const decorator = m[1] ?? "";
        const args = m[2] ?? "";
        const fieldName = m[3] ?? "";
        const fieldType = (m[4] ?? "").trim();
        if (decorator === "Type") continue;
        const map = VALIDATOR_MAP[decorator];
        if (!map) continue;
        const optional = new RegExp(`@IsOptional\b`).test(tail);
        fields.push({
          fieldName,
          location: "body",
          type: map.type,
          required: !optional,
          ...(map.format ? { format: map.format } : {}),
        });
      }
    }

    return { endpointKey, fields };
  }
}

/**
 * Parsea todos los imports del archivo del controller y devuelve un mapa
 * `TypeName → ruta absoluta del archivo del DTO`.
 */
function parseImports(text: string, controllerAbsPath: string): Map<string, string> {
  const out = new Map<string, string>();
  const dir = controllerAbsPath.replace(/[^/\\]+$/, "");
  // Match: `import { Foo, Bar } from "./path"` o `import { Foo } from "../path"`.
  const importRe = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(text)) !== null) {
    const names = (m[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const relPath = m[2] ?? "";
    if (!relPath.startsWith(".")) continue; // Skip paquetes npm.
    // Resolver a .ts file. Asumir extensión `.ts` o `.dto.ts`.
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
 * Lee un archivo DTO y devuelve los campos de la class `dtoTypeName`.
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
  const text = stripJsComments(raw);
  const lines = text.split("\n");

  // 1) Encontrar la línea `export class <dtoTypeName>`.
  const classIdx = lines.findIndex((l) =>
    new RegExp(`\\b(?:export\\s+)?class\\s+${dtoTypeName}\\b`).test(l),
  );
  if (classIdx < 0) return [];

  // 2) Recoger las líneas desde classIdx hasta el cierre `}` de la class.
  const fields: IValidationSpec[] = [];
  let braceDepth = 0;
  let started = false;
  // Buffer de decorators `@IsXxx(args)` antes del field.
  let pendingDecorators: Array<{ decorator: string; args: string }> = [];
  for (let i = classIdx; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (i === classIdx) {
      // Encontrar la primera `{` para empezar.
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

    // 3) Si la línea tiene solo decorators (`@Decorator()` o `@Decorator(args)`),
    //    agregarlos al buffer.
    const decOnly = line.match(/^\s*@([A-Z]\w*)\s*(?:\(([^)]*)\))?\s*$/);
    if (decOnly) {
      const decName = decOnly[1] ?? "";
      const decArgs = decOnly[2] ?? "";
      if (decName !== "Type") {
        pendingDecorators.push({ decorator: decName, args: decArgs });
      }
      continue;
    }

    // 4) Si la línea tiene `field: type` o `field!: type`, consumir el buffer
    //    y emitir los fields.
    const fm = /^[\s\S]*?([a-zA-Z_][\w]*)\s*(?:!|:)\s*:\s*([a-zA-Z_][\w\[\]<>,\s|"']*)/.exec(line);
    if (!fm || pendingDecorators.length === 0) {
      // Línea no-field; limpiar buffer.
      if (line.trim().length > 0 && !line.match(/^[\s,;]+$/)) {
        pendingDecorators = [];
      }
      continue;
    }
    const fieldName = fm[1] ?? "";
    const fieldType = (fm[2] ?? "").trim();

    for (const { decorator, args } of pendingDecorators) {
      const map = VALIDATOR_MAP[decorator];
      if (!map) continue;
      const optional = decorator === "IsOptional";
      const field: IValidationSpec = {
        fieldName,
        location: "body",
        type: map.type,
        required: !optional,
        ...(map.format ? { format: map.format } : {}),
      };
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
      // Length.
      if (decorator === "Length" || decorator === "MinLength" || decorator === "MaxLength") {
        const min = /min\s*:\s*(\d+)/i.exec(args);
        const max = /max\s*:\s*(\d+)/i.exec(args);
        if (decorator === "MinLength" || decorator === "Length") {
          if (min?.[1]) field.minLength = Number(min[1]);
        }
        if (decorator === "MaxLength" || decorator === "Length") {
          if (max?.[1]) field.maxLength = Number(max[1]);
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
      fields.push(field);
    }
    pendingDecorators = [];
    void fieldType; // unused pero útil para type-aware rules
  }
  return fields;
}
