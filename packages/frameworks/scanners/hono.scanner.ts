/**
 * `HonoScanner` — `IProjectScanner` + `IRouteScanner` para Hono.
 *
 * Hono es el framework de los runtimes de borde: Cloudflare Workers,
 * Deno, Bun y Node. Su sintaxis se parece a la de Express, pero con dos
 * diferencias que importan al escanear:
 *
 *   - **Encadena**: `app.get("/a", h).post("/b", h)` es válido, así que
 *     no basta con buscar `<ident>.method(`.
 *   - **Monta sub-apps**: `app.route("/api", usersApp)` es el
 *     equivalente de un router con prefijo.
 *
 * Validación: Hono la delega en `@hono/zod-validator`, que envuelve un
 * esquema de zod. Se reutiliza el parser de zod que ya existe en vez de
 * escribir otro — es la misma librería, solo cambia quién la invoca.
 */
import { existsSync } from "node:fs";
import { ownRegex } from "../../core/helpers/regex.helper.js";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { collectFiles, isSourceJsTsFile } from "../../core/helpers/fs-walk.helper.js";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import { findAllBalanced, findOutsideStrings, stripJsComments } from "../../core/helpers/source-scan.helper.js";
import { isRecord, parseJson } from "../../core/helpers/parse-json.helper.js";
import { joinRoutePath } from "../../core/helpers/uri.helper.js";
import { parseZodObjectLiteral, zodFieldToSpec } from "../parsers/zod-schema.helper.js";
import type {
  IEndpointValidation,
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../contracts/interfaces/core/scanner.interface.js";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "options", "all"] as const;

/**
 * Una llamada a método HTTP con su ruta.
 *
 * No exige un identificador delante justamente para cubrir el
 * encadenado: en `app.get("/a", h).post("/b", h)`, el `.post` no tiene
 * variable propia.
 */
const ROUTE_RE = new RegExp(
  String.raw`\.\s*(${HTTP_METHODS.join("|")})\s*\(\s*(['"\`])([^'"\`]+)\2`,
  "gi",
);

/** `app.route("/api", sub)` — el equivalente de montar un router. */
const MOUNT_RE = /\.\s*route\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*([\w$]+)/g;

/** `zValidator("json", EsquemaZod)` de `@hono/zod-validator`. */
const ZOD_VALIDATOR_RE = /zValidator\s*\(\s*(['"`])(\w+)\1\s*,\s*([\w$]+)/g;

/** Qué parte de la petición valida cada target de `zValidator`. */
const TARGET_TO_LOCATION: Record<string, IValidationSpec["location"]> = {
  json: "body",
  form: "body",
  query: "query",
  param: "path",
  header: "header",
  cookie: "cookie",
};

async function readPackageJson(projectRoot: string): Promise<Record<string, unknown> | null> {
  const path = join(projectRoot, "package.json");
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  const parsed = parseJson(raw);
  if (!parsed.ok) return null;
  return isRecord(parsed.value) ? parsed.value : null;
}

function honoDeps(pkg: Record<string, unknown> | null): Record<string, string> {
  if (!pkg) return {};
  return {
    ...((pkg["dependencies"] as Record<string, string>) ?? {}),
    ...((pkg["devDependencies"] as Record<string, string>) ?? {}),
  };
}

export class HonoProjectScanner implements IProjectScanner {
  readonly framework = "hono" as const;

  async detect(projectRoot: string): Promise<number> {
    const deps = honoDeps(await readPackageJson(projectRoot));
    if (deps["hono"]) return 1;
    // Solo un `@hono/*` puede ser un proyecto que lo use de refilón.
    return Object.keys(deps).some((name) => name.startsWith("@hono/")) ? 0.6 : 0;
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const deps = honoDeps(await readPackageJson(projectRoot));
    return {
      framework: "hono",
      projectRoot,
      artifacts: ["package.json"],
      ...(deps["hono"] ? { version: deps["hono"] } : {}),
    };
  }
}

export class HonoRouteScanner implements IRouteScanner {
  readonly framework = "hono" as const;

  /** `MÉTODO uri` → nombre del esquema de zod que la valida. */
  private readonly validators = new Map<string, { schema: string; file: string }>();

  matches(match: IProjectMatch): boolean {
    return match.framework === "hono";
  }

  validatorFor(method: string, uri: string): { schema: string; file: string } | undefined {
    return this.validators.get(`${method} ${uri}`);
  }

  async scan(match: IProjectMatch): Promise<ReadonlyArray<ParsedRoute>> {
    const files = await collectFiles(match.projectRoot, isSourceJsTsFile);
    const routes: ParsedRoute[] = [];

    // Lectura en paralelo con tope, entregada en el orden de
    // entrada: la colección tiene que salir igual cada vez.
    for await (const { path: file, text: raw } of readFilesInOrder(files)) {
      if (!/\bhono\b|new Hono\(/i.test(raw)) continue;

      const source = stripJsComments(raw);
      const sourceFile = relative(match.projectRoot, file);
      const prefix = mountPrefixOf(source);

      // `findOutsideStrings` en vez de `matchAll`: una llamada escrita
      // dentro de un texto —`'usa app.get("/x")'`— no es una ruta, y
      // producía un endpoint que no existe en ninguna parte.
      for (const { match: routeMatch, index } of findOutsideStrings(source, ROUTE_RE)) {
        const rawMethod = (routeMatch[1] ?? "").toLowerCase();
        const rawUri = routeMatch[3] ?? "";
        if (!rawUri.startsWith("/")) continue;

        // `.all()` responde a cualquier método; se emite como GET, que
        // es el que alguien va a querer probar primero.
        const method = rawMethod === "all" ? "GET" : rawMethod.toUpperCase();
        const uri = joinRoutePath(prefix, rawUri);

        routes.push({
          lineNumber: lineOf(source, index),
          method,
          uri,
          rawUri,
          sourceFile,
          prefixChain: prefix ? [prefix] : [],
        });

        const validator = validatorInCall(source, routeMatch.index ?? 0);
        if (validator) this.validators.set(`${method} ${uri}`, { ...validator, file });
      }
    }

    return dedupe(routes);
  }
}

/**
 * Prefijo con el que se monta este fichero, si se monta con uno.
 *
 * Solo se aplica cuando hay **un** montaje en el fichero: con varios no
 * se puede saber cuál corresponde a qué ruta sin seguir las variables,
 * y equivocarse de prefijo es peor que no poner ninguno.
 */
function mountPrefixOf(source: string): string {
  const mounts = [...source.matchAll(MOUNT_RE)].map((m) => m[2] ?? "");
  return mounts.length === 1 ? (mounts[0] ?? "") : "";
}

/**
 * El `zValidator(...)` de una ruta, buscado **dentro de su propia
 * llamada**.
 *
 * Con una ventana de caracteres, un `app.get("/health", h)` sin
 * validador se quedaba con el de la ruta de más abajo y salía con
 * reglas ajenas. Equilibrando los paréntesis, una ruta sin validador no
 * encuentra ninguno.
 */
function validatorInCall(
  source: string,
  routeStart: number,
): { schema: string; target: string } | null {
  const parenAt = source.indexOf("(", routeStart);
  if (parenAt === -1) return null;

  let depth = 0;
  let callEnd = -1;
  for (let i = parenAt; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) {
        callEnd = i;
        break;
      }
    }
  }
  if (callEnd === -1) return null;

  const call = source.slice(parenAt, callEnd);
  const match = ownRegex(ZOD_VALIDATOR_RE).exec(call);
  if (!match) return null;
  return { target: match[2] ?? "json", schema: match[3] ?? "" };
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
 * Reglas desde `@hono/zod-validator`.
 *
 * Reutiliza el parser de zod que ya existe: es la misma librería que en
 * Express o Next.js, solo cambia quién la invoca. Escribir un segundo
 * parser de zod sería la forma más rápida de que los dos divergieran.
 */
export class HonoZodValidatorProvider implements IValidationSpecProvider {
  readonly framework = "hono" as const;

  constructor(private readonly scanner: HonoRouteScanner) {}

  async supports(route: ParsedRoute, _match: IProjectMatch): Promise<boolean> {
    return this.scanner.validatorFor(route.method, route.uri) !== undefined;
  }

  async resolve(route: ParsedRoute, _match: IProjectMatch): Promise<IEndpointValidation> {
    const endpointKey = `${route.method} ${route.uri}`;
    const validator = this.scanner.validatorFor(route.method, route.uri);
    if (!validator) return { endpointKey, fields: [] };

    let source: string;
    try {
      source = stripJsComments(await readFile(validator.file, "utf8"));
    } catch {
      return { endpointKey, fields: [] };
    }

    const location = locationOfValidator(source, validator.schema);
    const literal = zodObjectLiteralOf(source, validator.schema);
    if (!literal) return { endpointKey, fields: [] };

    const fields = parseZodObjectLiteral(literal).map((field) =>
      zodFieldToSpec(field, location),
    );
    return { endpointKey, fields };
  }
}

/**
 * El literal del `z.object({…})` que declara un esquema con nombre.
 *
 * Usa `findAllBalanced`, que es el mismo camino que sigue el scanner de
 * Express para lo mismo. Escribir aquí otro recorrido de llaves sería
 * mantener dos implementaciones de la misma idea, y la segunda siempre
 * es la que se queda sin arreglar.
 *
 * El corte **incluye** las llaves: es lo que espera
 * `parseZodObjectLiteral`, y es la convención que ya seguían los otros
 * scanners.
 */
function zodObjectLiteralOf(source: string, schemaName: string): string | null {
  const declaration = new RegExp(
    String.raw`(?:const|let|var)\s+${schemaName}\s*(?::[^=]+)?=\s*z\s*\.\s*object\s*`,
    "g",
  );
  const call = findAllBalanced(source, declaration)[0];
  if (!call) return null;
  return source.slice(call.callStart + 1, call.callEnd);
}

/** Dónde van los campos de un esquema, según el target del validador. */
function locationOfValidator(source: string, schemaName: string): IValidationSpec["location"] {
  let match: RegExpExecArray | null;
  const zodValidatorRe = ownRegex(ZOD_VALIDATOR_RE);
  while ((match = zodValidatorRe.exec(source)) !== null) {
    if (match[3] === schemaName) return TARGET_TO_LOCATION[match[2] ?? "json"] ?? "body";
  }
  return "body";
}
