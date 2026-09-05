/**
 * `FiberScanner` — `IProjectScanner` + `IRouteScanner` +
 * `IValidationSpecProvider` for Fiber (Go).
 *
 * Fiber deliberately copies the Express API, but in Go: methods are
 * capitalised (`app.Get`) and path params use `:`. Detection is via
 * `go.mod`, same as Gin.
 *
 * We don't reuse Gin's scanner because the differences are not
 * cosmetic: Fiber groups with `app.Group("/api")` returning a
 * chainable `fiber.Router`, and its validation tags are
 * `validate:"required"` (go-playground/validator) instead of Gin's
 * `binding:"required"`.
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { ownRegex } from "../../core/helpers/regex.helper.js";
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

/** Fiber's methods, capitalised the way Go writes them. */
const METHODS = ["Get", "Post", "Put", "Delete", "Patch", "Head", "Options", "All"] as const;

const ROUTE_RE = new RegExp(
  String.raw`\b([\w.]+)\s*\.\s*(${METHODS.join("|")})\s*\(\s*"([^"]+)"`,
  "g",
);

/** `api := app.Group("/api")` — the variable then carries that prefix. */
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

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    if (!(await usesFiber(projectRoot))) return emptyResult(0);
    const hasEntrypoint =
      existsSync(join(projectRoot, "main.go")) || existsSync(join(projectRoot, "cmd"));
    return withEvidence(hasEntrypoint ? 1 : 0.5, [
      { signal: "go.mod con import fiber", weight: hasEntrypoint ? 0.6 : 0.5, artifact: "go.mod" },
      ...(hasEntrypoint ? [{ signal: "main.go o cmd/ presente", weight: 0.4, artifact: "main.go" }] : []),
    ]);
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    return { framework: "fiber", projectRoot, artifacts: ["go.mod"] };
  }
}

export class FiberRouteScanner implements IRouteScanner {
  readonly framework = "fiber" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "fiber";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    // a00012 S1.b / a00014 S2: the effective root respects
    // `frameworkSearchRoot` for monorepos. Before it was
    // `match.projectRoot` directly, which in a monorepo made
    // `collectFiles` walk the whole workspace tree instead of the
    // framework's subdirectory.
    const files = await collectFiles(effectiveProjectRoot(match), isGoSourceFile);
    const routes: ParsedRoute[] = [];
    // `structs` lives here, not as an instance `private readonly`: if it
    // survived across calls, two consecutive scans would share structs
    // and a route without `BodyParser` would inherit the previous one.
    // This is the bug a00010 S2 closed.
    const structs = new Map<string, IStructDescriptor>();

    // Parallel reads with a cap, delivered in input order: the
    // collection must come out identical every time.
    for await (const { path: file, text: source } of readFilesInOrder(files)) {
      if (!/fiber/i.test(source)) continue;

      const sourceFile = relative(rawProjectRoot(match), file);
      const groups = groupPrefixes(source);
      let routeMatch: RegExpExecArray | null;
      const routeRe = ownRegex(ROUTE_RE);
      while ((routeMatch = routeRe.exec(source)) !== null) {
        const receiver = routeMatch[1] ?? "";
        const rawMethod = routeMatch[2] ?? "";
        const rawUri = routeMatch[3] ?? "";
        if (!rawUri.startsWith("/")) continue;

        // `All` answers to any method; we emit it as GET, which is the one
        // people want to try first.
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
        if (struct) {
          structs.set(`${method} ${uri}`, { name: struct, file });
        }
      }
    }

    const unique = dedupe(routes);
    return {
      routes: unique,
      ...(structs.size > 0 ? { structs } : {}),
    };
  }
}

/** Variable → prefix, for the `Group("/api")` calls. */
function groupPrefixes(source: string): Map<string, string> {
  const groups = new Map<string, string>();
  let match: RegExpExecArray | null;
  const groupRe = ownRegex(GROUP_RE);
  while ((match = groupRe.exec(source)) !== null) {
    groups.set(match[1] ?? "", match[2] ?? "");
  }
  return groups;
}

/**
 * The struct the handler parses with `BodyParser`.
 *
 * Fiber declares the body like this:
 *
 *     var body CreateUserRequest
 *     if err := c.BodyParser(&body); err != nil { … }
 *
 * It's searched inside the handler, which starts right after the
 * route. The window is generous because the handler can be long, but
 * it stops at the next route declaration to not steal its struct.
 */
function bodyStructNear(source: string, routeStart: number): string | null {
  // Own regex, NOT `ROUTE_RE`.
  //
  // Reusing the outer loop's means sharing its `lastIndex`. The first
  // version moved it to find the next route and then put it back at the
  // current match's start — so the outer loop kept finding the SAME
  // route, forever. An infinite loop that eats memory until the system
  // kills the process.
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
 * Rules from `validate:"…"` tags of go-playground/validator.
 *
 * It's Fiber's equivalent of Gin's `binding:"…"`: the same idea under
 * a different name, because Fiber doesn't ship its own validator and
 * everyone uses the same package.
 *
 * It does not retain the scanner: the struct that parses the body and
 * the file where it is declared ride along in `scanResult.structs`,
 * which is filled on each `scan()` and discarded when it ends. Before it
 * had `private readonly scanner: FiberRouteScanner` and an instance
 * `Map`, and two consecutive scans would contaminate each other
 * (a00010 S2).
 */
export class FiberValidateTagProvider implements IValidationSpecProvider {
  readonly framework = "fiber" as const;

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
    return { endpointKey, fields: parseGoStruct(source, target.name) };
  }
}

/** Fields of a Go struct, reading its tags. */
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
  let field: RegExpExecArray | null;
  const structFieldRe = ownRegex(STRUCT_FIELD_RE);
  while ((field = structFieldRe.exec(body)) !== null) {
    const goType = field[2] ?? "";
    const tags = field[3] ?? "";

    // The name that travels over the wire is the one in the `json` tag,
    // not the Go field name: `Name string \`json:"name"\`` is sent as
    // `name`.
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
