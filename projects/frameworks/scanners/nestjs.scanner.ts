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
import { ownRegex } from "../../core/helpers/regex.helper.js";
import { readFile, readdir } from "node:fs/promises";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import { declaredDependencies, parseJson } from "../../core/helpers/parse-json.helper.js";
import { join } from "node:path";
import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contracts/interfaces/core/scanner.interface.js";

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
  const parsed = parseJson(raw);
  if (!parsed.ok) return false;
  // `declaredDependencies` funde `dependencies` y `devDependencies`, que
  // es la pregunta que se hace de verdad: un framework declarado en las
  // de desarrollo sigue siendo el framework del proyecto. Unos scanners
  // las miraban y otros no.
  const deps = declaredDependencies(parsed.value);
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
    for (let i = controllerMatchIndex + 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      let m: RegExpExecArray | null;
      const methodDecoratorRe = ownRegex(METHOD_DECORATOR_RE);
      while ((m = methodDecoratorRe.exec(line)) !== null) {
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
      fields = dtoPath
        ? await parseDtoFile(dtoPath, dtoTypeName)
        : // Sin import, la clase está en este mismo fichero. Es lo que
          // hace media documentación de Nest y cualquier proyecto
          // pequeño, y hasta ahora se quedaba sin body.
          parseDtoSource(text, dtoTypeName);
      // Un import que apunta a un barrel (`./dto`) puede no llevar a la
      // clase. Si no salió nada, se mira aquí igualmente antes de
      // rendirse.
      if (fields.length === 0) fields = parseDtoSource(text, dtoTypeName);
    }

    // 4) Los parámetros sueltos de la firma: `@Query("page") page: number`,
    //    `@Param("id") id: string`, `@Headers("x-tenant") tenant: string`.
    //
    // Esto era un fallback con un regex que emparejaba un decorador con
    // **cualquier** campo dentro de las 9 líneas anteriores (`[\s\S]*?`
    // entre medias) y lo marcaba todo como `body`. El resultado era que
    // un `@Query("page")` de un GET aparecía documentado como campo de
    // body, con el tipo del primer `@IsString()` que pillara por encima.
    // Un GET no tiene body, así que la colección afirmaba algo imposible.
    fields.push(...parseSignatureParams(sigLine));

    return { endpointKey, fields };
  }
}

/**
 * Los parámetros que NestJS inyecta por decorador en la firma.
 *
 * `@Query("page") page: number` es un parámetro de query, no un campo de
 * body, y la diferencia importa: un GET no tiene body, así que
 * documentarlo ahí describe una petición que no se puede hacer.
 *
 * `@Body()` no entra: ese lo resuelve el DTO, que trae mucha más
 * información (obligatoriedad, formatos, cotas) que el tipo de
 * TypeScript.
 */
const PARAM_DECORATORS: Readonly<Record<string, IValidationSpec["location"]>> = {
  Query: "query",
  Param: "path",
  Headers: "header",
};

/** Tipo de TypeScript → tipo del contrato. Lo que no se reconoce, string. */
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
  // El decorador y su parámetro van pegados: `@Query("page") page: number`.
  // Sin espacio arbitrario entre medias no se puede emparejar un
  // decorador con un campo que no es suyo.
  const re = /@(Query|Param|Headers)\s*\(\s*(?:["']([^"']+)["'])?\s*\)\s*([a-zA-Z_][\w]*)\s*\??\s*:\s*([a-zA-Z_][\w\[\]<>|]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sigLine)) !== null) {
    const location = PARAM_DECORATORS[m[1] ?? ""];
    if (!location) continue;
    // El nombre lo manda el argumento del decorador (`@Query("page")`);
    // si no lo lleva, el de la variable.
    const fieldName = m[2] || m[3] || "";
    if (!fieldName) continue;
    out.push({
      fieldName,
      location,
      type: tsTypeToSpecType(m[4] ?? ""),
      // Un `?` en la firma es opcional; el resto se asume obligatorio,
      // que es lo que NestJS hace por defecto.
      required: !new RegExp(`\\b${m[3]}\\s*\\?\\s*:`).test(sigLine),
    });
  }
  return out;
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
  return parseDtoSource(stripJsComments(raw), dtoTypeName);
}

/**
 * Los campos de una clase DTO, buscándola dentro de un fuente ya leído.
 *
 * Va aparte de `parseDtoFile` porque el DTO **no siempre está en otro
 * fichero**. Un controlador de NestJS con su `class CreateUserDto`
 * declarada encima —que es lo que enseña media documentación de Nest y
 * lo que hace cualquiera en un proyecto pequeño— no importa nada, así
 * que la resolución por imports no encontraba la clase y el endpoint
 * salía sin body. El fallback que había miraba solo las 8 líneas justo
 * encima de la firma, donde no está la clase.
 *
 * `source` tiene que venir ya sin comentarios.
 */
function parseDtoSource(text: string, dtoTypeName: string): IValidationSpec[] {
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

    // 4) Si la línea tiene `field: type`, `field!: type` o `field?: type`,
    //    consumir el buffer y emitir los fields.
    //
    // El patrón era `(?:!|:)\s*:`, o sea que exigía DOS puntos: `field!:`
    // o `field::`. Un `name: string` normal —la forma en que se declara
    // el 99% de los DTO— no casaba nunca, así que el parser de DTOs de
    // NestJS no sacaba un solo campo, ni de un fichero aparte ni de la
    // misma clase. El `?` de los opcionales tampoco estaba contemplado.
    const fm = /^[\s\S]*?([a-zA-Z_][\w]*)\s*[!?]?\s*:\s*([a-zA-Z_][\w\[\]<>,\s|"']*)/.exec(line);
    if (!fm || pendingDecorators.length === 0) {
      // Línea no-field; limpiar buffer.
      if (line.trim().length > 0 && !line.match(/^[\s,;]+$/)) {
        pendingDecorators = [];
      }
      continue;
    }
    const fieldName = fm[1] ?? "";
    const fieldType = (fm[2] ?? "").trim();

    // Un campo, una spec.
    //
    // Esto emitía **una spec por decorador**, así que
    // `@IsString() @MinLength(1) @MaxLength(100) name: string` producía
    // tres campos llamados `name` —cada uno con un trozo de la
    // información y ninguno con toda— y el body de ejemplo salía con la
    // misma clave repetida. Ahora los decoradores de un campo se funden
    // en la misma spec, que es lo que son: distintas restricciones sobre
    // una sola cosa.
    const field: IValidationSpec = {
      fieldName,
      location: "body",
      type: "string",
      // `@IsOptional()` puede venir antes o después del resto, así que se
      // decide mirando todos los decoradores del campo, no el de turno.
      required: !pendingDecorators.some((d) => d.decorator === "IsOptional"),
    };
    let recognised = false;

    for (const { decorator, args } of pendingDecorators) {
      const map = VALIDATOR_MAP[decorator];
      if (!map) continue;
      recognised = true;
      // `IsOptional` solo habla de obligatoriedad, ya resuelta arriba: no
      // debe pisar el tipo que declara `@IsInt()` o `@IsEmail()`.
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
      // Length. Los argumentos de class-validator son POSICIONALES:
      // `@MinLength(1)`, `@MaxLength(100)`, `@Length(1, 100)`.
      //
      // Esto buscaba `min: 1` / `max: 100`, una forma con nombre que
      // class-validator no tiene y que ni siquiera es TypeScript válido
      // como argumento suelto. O sea que ninguna de las tres sacaba
      // nunca su valor: el campo salía sin cotas y nadie se enteraba.
      if (decorator === "Length" || decorator === "MinLength" || decorator === "MaxLength") {
        const numbers = [...args.matchAll(/\d+/g)].map((m) => Number(m[0]));
        if (decorator === "MinLength" && numbers[0] !== undefined) {
          field.minLength = numbers[0];
        }
        if (decorator === "MaxLength" && numbers[0] !== undefined) {
          field.maxLength = numbers[0];
        }
        if (decorator === "Length") {
          // `@Length(min)` y `@Length(min, max)`.
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
    // Sin ningún decorador de class-validator no es un campo validado:
    // es una propiedad cualquiera de la clase.
    if (recognised) fields.push(field);
    pendingDecorators = [];
    void fieldType; // unused pero útil para type-aware rules
  }
  return fields;
}
