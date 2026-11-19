/**
 * `RustScanner` — `IProjectScanner` + `IRouteScanner` +
 * `IValidationSpecProvider` for Actix-web and Rocket.
 *
 * Both live in one scanner because they declare routes **the same way**:
 * an attribute macro above the handler.
 *
 *     #[get("/users")]           // Actix and Rocket
 *     #[post("/users/<id>")]     // Rocket uses <id>
 *     #[post("/users/{id}")]     // Actix uses {id}
 *
 * Splitting them would duplicate the same parser just to change two
 * lines of detection. What does change is the path-param syntax, and
 * that is normalised at the end.
 *
 * Actix also has the programmatic form —`.route("/x", web::get())`—
 * and `scope("/api")` for prefixes.
 *
 * Validation: the ecosystem uses `serde` for deserialisation and the
 * `validator` crate for the rules, with `#[validate(...)]` on the
 * struct fields.
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

/** `#[get("/users")]` — the attribute macro, in Actix and Rocket. */
const ATTR_ROUTE_RE = new RegExp(
  String.raw`#\[\s*(${HTTP_METHODS.join("|")})\s*\(\s*"([^"]+)"`,
  "gi",
);

/** `.route("/users", web::get().to(handler))` — the Actix form. */
const PROGRAMMATIC_RE =
  /\.route\s*\(\s*"([^"]+)"\s*,\s*web::(get|post|put|delete|patch|head)\s*\(/gi;

/** `.service(web::scope("/api"))` — Actix prefix. */
const SCOPE_RE = /web::scope\s*\(\s*"([^"]+)"/g;

/** Signature of the handler following the macro: gives its name. */
const HANDLER_RE = /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)/;

/** `Json<CreateUser>` or `web::Json<CreateUser>` in the arguments. */
const JSON_ARG_RE = /(?:web::)?Json\s*<\s*(\w+)\s*>/;

/** Struct field with its attributes above. */
const STRUCT_FIELD_RE = /(?:^|\n)((?:\s*#\[[^\]]*\]\s*\n)*)\s*(?:pub\s+)?(\w+)\s*:\s*([^,\n]+)/g;

function isRustSourceFile(name: string): boolean {
  return name.endsWith(".rs");
}

/** Which web crate the project uses, if any. */
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
    // a00012 S1.b / a00014 S2: the effective root respects
    // `frameworkSearchRoot` for monorepos. Before it was
    // `match.projectRoot` directly, which in a monorepo made
    // `collectFiles` walk the whole workspace tree instead of the
    // framework's subdirectory.
    const files = await collectFiles(effectiveProjectRoot(match), isRustSourceFile);
    const routes: ParsedRoute[] = [];
    // `structs` lives here, not as an instance `private readonly`: if it
    // survived across calls, two consecutive scans would share structs
    // and a route without `Json<T>` would inherit the previous one.
    // This is the bug a00010 S2 closed.
    const structs = new Map<string, IStructDescriptor>();

    // Parallel reads with a cap, delivered in input order: the
    // collection must come out identical every time.
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
 * Prefix from `web::scope("/api")`, if the file declares exactly one.
 *
 * With several we can't tell which one covers which route without
 * following the service tree, and putting the wrong prefix is worse
 * than putting none.
 */
function scopePrefixOf(source: string): string {
  const scopes = [...source.matchAll(SCOPE_RE)].map((m) => m[1] ?? "");
  return scopes.length === 1 ? (scopes[0] ?? "") : "";
}

/** A route declared with a macro, with its body struct if any. */
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

    // The handler comes right after the macro; its arguments tell whether
    // there is a `Json<T>` to deserialise.
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
 * Unifies the path-param syntax of the two crates.
 *
 * Rocket writes `<id>` and Actix `{id}`. The rest of the pipeline
 * expects a single form, so we normalise here — in the layer that
 * knows about Rust — and not downstream.
 */
export function normalizePathParams(uri: string): string {
  return uri.replace(/<([^>/]+)>/g, (_whole, name: string) => {
    // Rocket accepts `<id..>` for multiple segments: the name is
    // whatever comes before the dots.
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

/** Rules from `#[validate(...)]` of the `validator` crate. */
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

/** Fields of a Rust struct, with its `validate` and `serde` attributes. */
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

    // `#[serde(rename = "x")]` changes the name that travels over the wire.
    const renamed = /serde\s*\([^)]*rename\s*=\s*"([^"]+)"/.exec(attributes)?.[1];
    const validate = /validate\s*\(([^\]]*)\)/.exec(attributes)?.[1] ?? "";

    // In Rust, optionality is marked on the TYPE (`Option<T>`), not as an
    // attribute: that's the key difference from the other ecosystems.
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
