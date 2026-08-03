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
import { join } from "node:path";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contract/scanner.interface.js";

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
    return out;
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
        const fullPath = (controllerPath + "/" + subPath).replace(/\/+/g, "/");
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

    // 2) Recoger los decorators + cuerpo (bestEffort).
    const block: string[] = [];
    let braceDepth = 0;
    let started = false;
    for (let i = sigIdx; i < lines.length; i++) {
      const line = lines[i] ?? "";
      block.push(line);
      for (const c of line) {
        if (c === "{") {
          braceDepth++;
          if (braceDepth >= 1) started = true;
        } else if (c === "}") {
          braceDepth--;
          if (started && braceDepth === 0) break;
        }
      }
      if (started && braceDepth === 0) break;
    }

    // 3) Recoger TODOS los decorators `@IsXxx() field: type` desde la signature
    //    hacia atrás (entre `findSignature - 5` y `sigIdx`).
    const fields: IValidationSpec[] = [];
    const tail = lines.slice(Math.max(0, sigIdx - 8), sigIdx + 1).join("\n");
    // Patrón: `@Decorator(args) fieldName: type,` o `@Decorator() fieldName: type;`
    const fieldRe = /@([A-Z]\w*)\s*(?:\(([^)]*)\))?\s*(?:[\s\S]*?)\s*([a-zA-Z_][\w]*)\s*:\s*([a-zA-Z_][\w\[\]<>,\s|"']*)/g;
    let m: RegExpExecArray | null;
    while ((m = fieldRe.exec(tail)) !== null) {
      const decorator = m[1] ?? "";
      const args = m[2] ?? "";
      const fieldName = m[3] ?? "";
      const fieldType = (m[4] ?? "").trim();
      if (decorator === "Type") continue; // @Type(() => X) es class-transformer, no validator.
      const map = VALIDATOR_MAP[decorator];
      if (!map) continue;
      const optional = new RegExp(`@IsOptional\b`).test(tail);
      const field: IValidationSpec = {
        fieldName,
        location: "body",
        type: map.type,
        required: !optional,
        ...(map.format ? { format: map.format } : {}),
      };
      // Enum: extraer valores.
      if (decorator === "IsEnum") {
        const values = args.match(/\[([^\]]+)\]/);
        if (values?.[1]) {
          field.enumValues = values[1]
            .split(",")
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
            .filter(Boolean);
        }
      }
      // Length: extraer min/max.
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
      // Min/Max: numéricos.
      if (decorator === "Min" || decorator === "Max") {
        const v = /(\d+)/.exec(args);
        if (v?.[1]) {
          if (decorator === "Min") field.minimum = Number(v[1]);
          else field.maximum = Number(v[1]);
        }
      }
      fields.push(field);
    }
    return { endpointKey, fields };
  }
}
