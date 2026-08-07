/**
 * `FiberScanner` — `IProjectScanner` + `IRouteScanner` +
 * `IValidationSpecProvider` para Fiber (Go).
 *
 * Fiber copia deliberadamente la API de Express, pero en Go: los
 * métodos van en mayúscula (`app.Get`) y los path params llevan `:`.
 * La detección es por `go.mod`, igual que Gin.
 *
 * No se reutiliza el scanner de Gin porque las diferencias no son
 * cosméticas: Fiber agrupa con `app.Group("/api")` devolviendo un
 * `fiber.Router` que se encadena, y sus tags de validación son
 * `validate:"required"` (go-playground/validator) en vez del
 * `binding:"required"` de Gin.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { collectFiles } from "../../core/helpers/fs-walk.helper.js";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import type {
  IEndpointValidation,
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../core/contracts/scanner.interface.js";

/** Métodos de Fiber, capitalizados como los escribe Go. */
const METHODS = ["Get", "Post", "Put", "Delete", "Patch", "Head", "Options", "All"] as const;

const ROUTE_RE = new RegExp(
  String.raw`\b([\w.]+)\s*\.\s*(${METHODS.join("|")})\s*\(\s*"([^"]+)"`,
  "g",
);

/** `api := app.Group("/api")` — la variable pasa a llevar ese prefijo. */
const GROUP_RE = /\b(\w+)\s*:?=\s*[\w.]+\s*\.\s*Group\s*\(\s*"([^"]+)"/g;

/** Un campo de struct con su tag: `Name string \`json:"name" validate:"required"\`` */
const STRUCT_FIELD_RE =
  /^\s*(\w+)\s+([\w*\[\]./]+)\s+`([^`]*)`/gm;

function isGoSourceFile(name: string): boolean {
  return name.endsWith(".go") && !name.endsWith("_test.go");
}

async function usesFiber(projectRoot: string): Promise<boolean> {
  const goMod = join(projectRoot, "go.mod");
  if (!existsSync(goMod)) return false;
  try {
    return /github\.com\/gofiber\/fiber/.test(await readFile(goMod, "utf8"));
  } catch {
    return false;
  }
}

export class FiberProjectScanner implements IProjectScanner {
  readonly framework = "fiber" as const;

  async detect(projectRoot: string): Promise<number> {
    if (!(await usesFiber(projectRoot))) return 0;
    const hasEntrypoint =
      existsSync(join(projectRoot, "main.go")) || existsSync(join(projectRoot, "cmd"));
    return hasEntrypoint ? 1 : 0.5;
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    return { framework: "fiber", projectRoot, artifacts: ["go.mod"] };
  }
}

export class FiberRouteScanner implements IRouteScanner {
  readonly framework = "fiber" as const;

  /** `MÉTODO uri` → nombre del struct que valida su body. */
  private readonly bodyStructs = new Map<string, { struct: string; file: string }>();

  matches(match: IProjectMatch): boolean {
    return match.framework === "fiber";
  }

  structFor(method: string, uri: string): { struct: string; file: string } | undefined {
    return this.bodyStructs.get(`${method} ${uri}`);
  }

  async scan(match: IProjectMatch): Promise<ReadonlyArray<ParsedRoute>> {
    const files = await collectFiles(match.projectRoot, isGoSourceFile);
    const routes: ParsedRoute[] = [];

    for (const file of files) {
      let source: string;
      try {
        source = await readFile(file, "utf8");
      } catch {
        continue;
      }
      if (!/fiber/i.test(source)) continue;

      const sourceFile = relative(match.projectRoot, file);
      const groups = groupPrefixes(source);

      ROUTE_RE.lastIndex = 0;
      let routeMatch: RegExpExecArray | null;
      while ((routeMatch = ROUTE_RE.exec(source)) !== null) {
        const receiver = routeMatch[1] ?? "";
        const rawMethod = routeMatch[2] ?? "";
        const rawUri = routeMatch[3] ?? "";
        if (!rawUri.startsWith("/")) continue;

        // `All` responde a cualquier método; se emite como GET, que es
        // el que alguien quiere probar primero.
        const method = rawMethod === "All" ? "GET" : rawMethod.toUpperCase();
        const prefix = groups.get(receiver) ?? "";
        const uri = joinRoutePath(prefix, rawUri);

        routes.push({
          lineNumber: lineOf(source, routeMatch.index),
          method,
          uri,
          rawUri,
          sourceFile,
          prefixChain: prefix ? [prefix] : [],
        });

        const struct = bodyStructNear(source, routeMatch.index);
        if (struct) this.bodyStructs.set(`${method} ${uri}`, { struct, file });
      }
    }

    return dedupe(routes);
  }
}

/** Variable → prefijo, para los `Group("/api")`. */
function groupPrefixes(source: string): Map<string, string> {
  const groups = new Map<string, string>();
  GROUP_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = GROUP_RE.exec(source)) !== null) {
    groups.set(match[1] ?? "", match[2] ?? "");
  }
  return groups;
}

/**
 * El struct que el handler parsea con `BodyParser`.
 *
 * Fiber declara el body así:
 *
 *     var body CreateUserRequest
 *     if err := c.BodyParser(&body); err != nil { … }
 *
 * Se busca dentro del handler, que empieza justo tras la ruta. La
 * ventana es generosa porque el handler puede ser largo, pero se corta
 * en la siguiente declaración de ruta para no robarle el struct.
 */
function bodyStructNear(source: string, routeStart: number): string | null {
  // Regex PROPIO, no `ROUTE_RE`.
  //
  // Reutilizar el del bucle exterior significa compartir su `lastIndex`.
  // La primera versión lo movía para buscar la ruta siguiente y luego lo
  // devolvía al inicio del match actual — con lo que el bucle exterior
  // volvía a encontrar la MISMA ruta, para siempre. Un bucle infinito
  // que se come la memoria hasta que el sistema mata el proceso.
  const lookahead = new RegExp(ROUTE_RE.source, ROUTE_RE.flags);
  lookahead.lastIndex = routeStart + 1;
  const next = lookahead.exec(source);
  const end = next ? next.index : source.length;

  const handler = source.slice(routeStart, end);
  const declared = /\bvar\s+\w+\s+(\w+)\b/.exec(handler)?.[1];
  const composite = /(\w+)\s*\{\s*\}\s*\n?\s*(?:if\s+)?err\s*:?=\s*c\.BodyParser/.exec(handler)?.[1];
  return composite ?? declared ?? null;
}

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

function dedupe(routes: ReadonlyArray<ParsedRoute>): ParsedRoute[] {
  const seen = new Set<string>();
  const out: ParsedRoute[] = [];
  for (const route of routes) {
    const key = `${route.method} ${route.uri}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(route);
  }
  return out;
}

/**
 * Reglas desde los tags `validate:"…"` de go-playground/validator.
 *
 * Es el equivalente de Fiber al `binding:"…"` de Gin: la misma idea con
 * otro nombre, porque Fiber no trae validador propio y todo el mundo usa
 * el mismo paquete.
 */
export class FiberValidateTagProvider implements IValidationSpecProvider {
  readonly framework = "fiber" as const;

  constructor(private readonly scanner: FiberRouteScanner) {}

  async supports(route: ParsedRoute, _match: IProjectMatch): Promise<boolean> {
    return this.scanner.structFor(route.method, route.uri) !== undefined;
  }

  async resolve(route: ParsedRoute, _match: IProjectMatch): Promise<IEndpointValidation> {
    const endpointKey = `${route.method} ${route.uri}`;
    const target = this.scanner.structFor(route.method, route.uri);
    if (!target) return { endpointKey, fields: [] };

    let source: string;
    try {
      source = await readFile(target.file, "utf8");
    } catch {
      return { endpointKey, fields: [] };
    }
    return { endpointKey, fields: parseGoStruct(source, target.struct) };
  }
}

/** Campos de un struct de Go, leyendo sus tags. */
export function parseGoStruct(source: string, structName: string): IValidationSpec[] {
  const declaration = new RegExp(
    String.raw`type\s+${structName}\s+struct\s*\{`,
  ).exec(source);
  if (!declaration) return [];

  const start = source.indexOf("{", declaration.index);
  let depth = 0;
  let body = "";
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        body = source.slice(start + 1, i);
        break;
      }
    }
  }
  if (!body) return [];

  const fields: IValidationSpec[] = [];
  STRUCT_FIELD_RE.lastIndex = 0;
  let field: RegExpExecArray | null;
  while ((field = STRUCT_FIELD_RE.exec(body)) !== null) {
    const goType = field[2] ?? "";
    const tags = field[3] ?? "";

    // El nombre que viaja por la red es el del tag `json`, no el del
    // campo de Go: `Name string \`json:"name"\`` se envía como `name`.
    const jsonTag = /json:"([^",]+)/.exec(tags)?.[1];
    const name = jsonTag ?? (field[1] ?? "");
    if (name === "-") continue;

    const validate = /validate:"([^"]*)"/.exec(tags)?.[1] ?? "";
    const rules = validate.split(",").map((rule) => rule.trim());

    fields.push({
      fieldName: name,
      location: "body",
      type: goTypeToSpecType(goType),
      required: rules.includes("required"),
      ...enumFrom(rules),
      ...boundsFrom(rules),
      ...formatFrom(rules),
    });
  }
  return fields;
}

function goTypeToSpecType(goType: string): IValidationSpec["type"] {
  const bare = goType.replace(/^[*\[\]]+/, "");
  if (goType.startsWith("[]")) return "array";
  if (/^(int|int8|int16|int32|int64|uint\d*)$/.test(bare)) return "integer";
  if (/^float(32|64)$/.test(bare)) return "number";
  if (bare === "bool") return "boolean";
  if (bare === "string") return "string";
  if (bare === "Time" || bare === "time.Time") return "datetime";
  return "object";
}

function enumFrom(rules: readonly string[]): Partial<IValidationSpec> {
  const oneof = rules.find((rule) => rule.startsWith("oneof="));
  if (!oneof) return {};
  const values = oneof.slice("oneof=".length).split(" ").filter(Boolean);
  return values.length > 0 ? { type: "enum", enumValues: values } : {};
}

function boundsFrom(rules: readonly string[]): Partial<IValidationSpec> {
  const out: Partial<IValidationSpec> = {};
  for (const rule of rules) {
    const [name, value] = rule.split("=");
    const numeric = Number(value);
    if (Number.isNaN(numeric)) continue;
    if (name === "min") out.minimum = numeric;
    if (name === "max") out.maximum = numeric;
    if (name === "len") {
      out.minLength = numeric;
      out.maxLength = numeric;
    }
  }
  return out;
}

function formatFrom(rules: readonly string[]): Partial<IValidationSpec> {
  for (const format of ["email", "url", "uuid", "ipv4", "ip"]) {
    if (rules.includes(format)) return { format };
  }
  return {};
}
