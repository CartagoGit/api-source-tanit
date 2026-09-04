/**
 * `RustScanner` — `IProjectScanner` + `IRouteScanner` +
 * `IValidationSpecProvider` para Actix-web y Rocket.
 *
 * Los dos van juntos en un scanner porque declaran las rutas **igual**:
 * un macro de atributo encima del handler.
 *
 *     #[get("/users")]           // Actix y Rocket
 *     #[post("/users/<id>")]     // Rocket usa <id>
 *     #[post("/users/{id}")]     // Actix usa {id}
 *
 * Separarlos sería duplicar el mismo parser para cambiar dos líneas de
 * detección. Lo que sí cambia es la forma del path param, y eso se
 * normaliza al final.
 *
 * Actix tiene además la forma programática —`.route("/x", web::get())`—
 * y el `scope("/api")` para prefijos.
 *
 * Validación: el ecosistema usa `serde` para deserializar y el crate
 * `validator` para las reglas, con `#[validate(...)]` sobre los campos
 * del struct.
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { collectFiles } from "../../core/helpers/fs-walk.helper.js";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import { effectiveProjectRoot, rawProjectRoot } from "../../core/discovery/effective-project-root.helper.js";
import type {
  IEndpointValidation,
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  IStructDescriptor,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"] as const;

/** `#[get("/users")]` — el macro de atributo, en Actix y en Rocket. */
const ATTR_ROUTE_RE = new RegExp(
  String.raw`#\[\s*(${HTTP_METHODS.join("|")})\s*\(\s*"([^"]+)"`,
  "gi",
);

/** `.route("/users", web::get().to(handler))` — la forma de Actix. */
const PROGRAMMATIC_RE =
  /\.route\s*\(\s*"([^"]+)"\s*,\s*web::(get|post|put|delete|patch|head)\s*\(/gi;

/** `.service(web::scope("/api"))` — prefijo en Actix. */
const SCOPE_RE = /web::scope\s*\(\s*"([^"]+)"/g;

/** La firma del handler que sigue al macro: da su nombre. */
const HANDLER_RE = /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)/;

/** `Json<CreateUser>` o `web::Json<CreateUser>` en los argumentos. */
const JSON_ARG_RE = /(?:web::)?Json\s*<\s*(\w+)\s*>/;

/** Campo de struct con sus atributos encima. */
const STRUCT_FIELD_RE = /(?:^|\n)((?:\s*#\[[^\]]*\]\s*\n)*)\s*(?:pub\s+)?(\w+)\s*:\s*([^,\n]+)/g;

function isRustSourceFile(name: string): boolean {
  return name.endsWith(".rs");
}

/** Qué crate web usa el proyecto, si usa alguno. */
async function detectCrate(projectRoot: string): Promise<"actix" | "rocket" | null> {
  const cargo = join(projectRoot, "Cargo.toml");
  if (!existsSync(cargo)) return null;
  let raw: string;
  try {
    raw = await readFile(cargo, "utf8");
  } catch {
    return null;
  }
  if (/^\s*actix-web\s*=/m.test(raw)) return "actix";
  if (/^\s*rocket\s*=/m.test(raw)) return "rocket";
  return null;
}

export class RustProjectScanner implements IProjectScanner {
  readonly framework = "rust" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const crate = await detectCrate(projectRoot);
    if (!crate) return emptyResult(0);
    const hasSrc = existsSync(join(projectRoot, "src"));
    return withEvidence(hasSrc ? 1 : 0.5, [
      { signal: `Cargo.toml declara framework web Rust (${crate})`, weight: 0.5, artifact: "Cargo.toml" },
      ...(hasSrc ? [{ signal: "src/ presente (convención del crate)", weight: 0.5, artifact: "src/" }] : []),
    ]);
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const crate = await detectCrate(projectRoot);
    return {
      framework: "rust",
      projectRoot,
      artifacts: ["Cargo.toml"],
      ...(crate ? { variant: crate } : {}),
    } as IProjectMatch;
  }
}

export class RustRouteScanner implements IRouteScanner {
  readonly framework = "rust" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "rust";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    // a00012 S1.b / a00014 S2: la raíz efectiva respeta
    // `frameworkSearchRoot` para monorepos. Antes era
    // `match.projectRoot` directo, lo que en un monorepo hacía que
    // `collectFiles` caminase el árbol del workspace entero en lugar
    // del subdirectorio del framework.
    const files = await collectFiles(effectiveProjectRoot(match), isRustSourceFile);
    const routes: ParsedRoute[] = [];
    // `structs` vive aquí, no como `private readonly` de instancia: si
    // sobreviviera entre llamadas, dos escaneos consecutivos compartirían
    // los structs y una ruta sin `Json<T>` heredaría el de la anterior.
    // Es el bug que cerró a00010 S2.
    const structs = new Map<string, IStructDescriptor>();

    // Lectura en paralelo con tope, entregada en el orden de
    // entrada: la colección tiene que salir igual cada vez.
    for await (const { path: file, text: source } of readFilesInOrder(files)) {

      const sourceFile = relative(rawProjectRoot(match), file);
      const prefix = scopePrefixOf(source);

      for (const route of parseAttributeRoutes(source, prefix, sourceFile)) {
        routes.push(route.route);
        if (route.bodyStruct) {
          structs.set(`${route.route.method} ${route.route.uri}`, {
            name: route.bodyStruct,
            file,
          });
        }
      }

      for (const route of parseProgrammaticRoutes(source, prefix, sourceFile)) {
        routes.push(route);
      }
    }

    const unique = dedupe(routes);
    return {
      routes: unique,
      ...(structs.size > 0 ? { structs } : {}),
    };
  }
}

/**
 * Prefijo del `web::scope("/api")`, si el fichero declara uno solo.
 *
 * Con varios no se puede saber cuál cubre a qué ruta sin seguir el
 * árbol de servicios, y poner el prefijo equivocado es peor que no
 * poner ninguno.
 */
function scopePrefixOf(source: string): string {
  const scopes = [...source.matchAll(SCOPE_RE)].map((m) => m[1] ?? "");
  return scopes.length === 1 ? (scopes[0] ?? "") : "";
}

/** Una ruta declarada con macro, con el struct de su body si lo tiene. */
interface IAttributeRoute {
  readonly route: ParsedRoute;
  readonly bodyStruct: string | null;
}

function parseAttributeRoutes(
  source: string,
  prefix: string,
  sourceFile: string,
): IAttributeRoute[] {
  const out: IAttributeRoute[] = [];
  const attrRe = new RegExp(ATTR_ROUTE_RE.source, ATTR_ROUTE_RE.flags);

  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(source)) !== null) {
    const method = (match[1] ?? "").toUpperCase();
    const rawUri = match[2] ?? "";
    if (!rawUri.startsWith("/")) continue;

    // El handler viene justo después del macro; sus argumentos dicen si
    // hay un `Json<T>` que deserializar.
    const after = source.slice(match.index, match.index + 600);
    const handler = HANDLER_RE.exec(after);
    const bodyStruct = handler ? (JSON_ARG_RE.exec(handler[2] ?? "")?.[1] ?? null) : null;

    out.push({
      route: {
        lineNumber: lineOf(source, match.index),
        method,
        uri: joinRoutePath(prefix, normalizePathParams(rawUri)),
        rawUri,
        sourceFile,
        prefixChain: prefix ? [prefix] : [],
      },
      bodyStruct,
    });
  }
  return out;
}

function parseProgrammaticRoutes(
  source: string,
  prefix: string,
  sourceFile: string,
): ParsedRoute[] {
  const out: ParsedRoute[] = [];
  const re = new RegExp(PROGRAMMATIC_RE.source, PROGRAMMATIC_RE.flags);

  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const rawUri = match[1] ?? "";
    if (!rawUri.startsWith("/")) continue;
    out.push({
      lineNumber: lineOf(source, match.index),
      method: (match[2] ?? "").toUpperCase(),
      uri: joinRoutePath(prefix, normalizePathParams(rawUri)),
      rawUri,
      sourceFile,
      prefixChain: prefix ? [prefix] : [],
    });
  }
  return out;
}

/**
 * Unifica la sintaxis de path param de los dos crates.
 *
 * Rocket escribe `<id>` y Actix `{id}`. El resto del pipeline espera
 * una sola forma, así que se normaliza aquí — en la capa que sabe de
 * Rust — y no aguas abajo.
 */
export function normalizePathParams(uri: string): string {
  return uri.replace(/<([^>/]+)>/g, (_whole, name: string) => {
    // Rocket admite `<id..>` para segmentos múltiples: el nombre es lo
    // que va antes de los puntos.
    const clean = name.replace(/\.\.$/, "");
    return `{${clean}}`;
  });
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

/** Reglas desde `#[validate(...)]` del crate `validator`. */
export class RustValidatorProvider implements IValidationSpecProvider {
  readonly framework = "rust" as const;

  async supports(
    route: ParsedRoute,
    _match: IProjectMatch,
    scanResult: IScanResult,
  ): Promise<boolean> {
    return scanResult.structs?.has(`${route.method} ${route.uri}`) ?? false;
  }

  async resolve(
    route: ParsedRoute,
    _match: IProjectMatch,
    scanResult: IScanResult,
  ): Promise<IEndpointValidation> {
    const endpointKey = `${route.method} ${route.uri}`;
    const target = scanResult.structs?.get(`${route.method} ${route.uri}`);
    if (!target) return { endpointKey, fields: [] };

    let source: string;
    try {
      source = await readFile(target.file, "utf8");
    } catch {
      return { endpointKey, fields: [] };
    }
    return { endpointKey, fields: parseRustStruct(source, target.name) };
  }
}

/** Campos de un struct de Rust, con sus atributos `validate` y `serde`. */
export function parseRustStruct(source: string, structName: string): IValidationSpec[] {
  const declaration = new RegExp(String.raw`struct\s+${structName}\s*\{`).exec(source);
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
  const fieldRe = new RegExp(STRUCT_FIELD_RE.source, STRUCT_FIELD_RE.flags);

  let field: RegExpExecArray | null;
  while ((field = fieldRe.exec(body)) !== null) {
    const attributes = field[1] ?? "";
    const name = field[2] ?? "";
    const rustType = (field[3] ?? "").trim();
    if (!name) continue;

    // `#[serde(rename = "x")]` cambia el nombre que viaja por la red.
    const renamed = /serde\s*\([^)]*rename\s*=\s*"([^"]+)"/.exec(attributes)?.[1];
    const validate = /validate\s*\(([^\]]*)\)/.exec(attributes)?.[1] ?? "";

    // En Rust lo opcional se marca en el TIPO (`Option<T>`), no en un
    // atributo: es la diferencia clave con los otros ecosistemas.
    const optional = /^Option\s*</.test(rustType);

    fields.push({
      fieldName: renamed ?? name,
      location: "body",
      type: rustTypeToSpecType(rustType),
      required: !optional,
      ...formatFrom(validate),
      ...boundsFrom(validate),
    });
  }
  return fields;
}

function rustTypeToSpecType(rustType: string): IValidationSpec["type"] {
  const inner = /^Option\s*<\s*(.+?)\s*>$/.exec(rustType)?.[1] ?? rustType;
  const bare = inner.trim();
  if (/^Vec\s*</.test(bare)) return "array";
  if (/^(i8|i16|i32|i64|i128|u8|u16|u32|u64|u128|usize|isize)$/.test(bare)) return "integer";
  if (/^f(32|64)$/.test(bare)) return "number";
  if (bare === "bool") return "boolean";
  if (bare === "String" || bare === "&str") return "string";
  return "object";
}

function formatFrom(validate: string): Partial<IValidationSpec> {
  if (/\bemail\b/.test(validate)) return { format: "email" };
  if (/\burl\b/.test(validate)) return { format: "url" };
  return {};
}

function boundsFrom(validate: string): Partial<IValidationSpec> {
  const out: Partial<IValidationSpec> = {};
  const min = /\bmin\s*=\s*(\d+)/.exec(validate)?.[1];
  const max = /\bmax\s*=\s*(\d+)/.exec(validate)?.[1];
  if (min) out.minLength = Number(min);
  if (max) out.maxLength = Number(max);

  const range = /range\s*\(\s*min\s*=\s*(\d+)\s*,\s*max\s*=\s*(\d+)/.exec(validate);
  if (range) {
    out.minimum = Number(range[1]);
    out.maximum = Number(range[2]);
  }
  return out;
}
