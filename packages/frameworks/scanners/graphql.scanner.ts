/**
 * `GraphQLScanner` — esquemas `.graphql` / `.gql` y SDL embebido.
 *
 * GraphQL no tiene rutas: tiene **un** endpoint —`/graphql` casi
 * siempre— y lo que cambia es el cuerpo. Así que aquí un "endpoint" de
 * la colección es una **operación** del esquema: cada campo de
 * `type Query` y de `type Mutation` sale como un `POST /graphql` con su
 * consulta ya escrita en el body.
 *
 * Eso es lo que hace la colección útil: quien la importa le da a Send y
 * la consulta se ejecuta. Una colección con un solo `POST /graphql` y el
 * body vacío no ahorra nada — el trabajo era justo escribir la consulta.
 *
 * Las suscripciones **no** se emiten. Van por WebSocket, y una petición
 * HTTP a `/graphql` con una `subscription` dentro no funciona: contesta
 * un error del servidor. Emitirla sería entregar algo que falla al
 * primer Send, que es peor que no entregarla.
 */
import { existsSync } from "node:fs";
import { emptyResult, withEvidence } from "./detect-result.helper";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  IScanResult,
  ParsedRoute, IProjectScannerResult} from "../../contracts/interfaces/core/scanner.interface";
import { collectFiles, isSourceJsTsFile } from "../../core/helpers/fs-walk.helper.js";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import { isRecord, parseJson } from "../../core/helpers/parse-json.helper.js";

/** Paquetes que delatan un servidor GraphQL. */
const GRAPHQL_PACKAGES = [
  "graphql",
  "@apollo/server",
  "apollo-server",
  "apollo-server-express",
  "graphql-yoga",
  "@nestjs/graphql",
  "type-graphql",
  "mercurius",
];

/** Rutas donde casi todo el mundo monta el endpoint. */
const DEFAULT_ENDPOINT = "/graphql";

/** Escalares de serie. No admiten selección de campos. */
const BUILTIN_SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID"]);

/**
 * Escalares personalizados del esquema (audit 2026-09-04 P1 #4).
 *
 * El parser los recoge de las directivas `scalar X` del esquema; un
 * `DateTime!` declarado por el usuario debe ir al conjunto de
 * escalares, no al conjunto de objetos, porque tampoco admite
 * selección de campos. Si no, el cuerpo generado pediría
 * `now { __typename }` sobre un escalar.
 */
const customScalars = new Set<string>();

/** Registra un escalar personalizado declarado con `scalar X`. */
function registerCustomScalar(name: string): void {
  if (!BUILTIN_SCALARS.has(name)) customScalars.add(name);
}

/** Devuelve true si el tipo (sin `[`, `]`, `!`) es escalar. */
function isScalarType(type: string): boolean {
  const bare = type.replace(/[[\]!]/g, "");
  return BUILTIN_SCALARS.has(bare) || customScalars.has(bare);
}

/**
 * Limpia el registro de escalares personalizados.
 *
 * Solo se usa en tests; el scanner real los va acumulando durante el
 * scan de un proyecto, lo que en un proceso de larga vida filtraría
 * memoria. En el pipeline real cada `scan()` cubre un solo esquema.
 */
export function _resetCustomScalars(): void {
  customScalars.clear();
}

/** Ficheros de esquema. */
function isSchemaFile(name: string): boolean {
  return name.endsWith(".graphql") || name.endsWith(".gql");
}

/**
 * Lockfiles presentes en `projectRoot` como señales bonus de runtime.
 *
 * f00011 S4: `pnpm-lock.yaml` y `bun.lockb` afinan la confianza del
 * detector sin ser detección. Pesos pequeños: +0.1 (pnpm), +0.15
 * (bun). El detector de GraphQL suma evidencia y luego devuelve el
 * `Math.max(fromPackage, 0.5)` o `1`; el bonus aparece en `evidence`
 * aunque el cap no le deje mover el score visible — exactamente lo
 * que se busca con esta propuesta: trazabilidad de runtime, no
 * detección nueva.
 */
function lockfileSignals(projectRoot: string): Array<{ signal: string; weight: number; artifact?: string }> {
  const out: Array<{ signal: string; weight: number; artifact?: string }> = [];
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) {
    out.push({ signal: "pnpm-lock.yaml presente", weight: 0.1, artifact: "pnpm-lock.yaml" });
  }
  if (existsSync(join(projectRoot, "bun.lockb"))) {
    out.push({ signal: "bun.lockb presente", weight: 0.15, artifact: "bun.lockb" });
  }
  return out;
}

export class GraphQlProjectScanner implements IProjectScanner {
  readonly framework = "graphql" as const;

  async detect(projectRoot: string): Promise<IProjectScannerResult> {
    const pkgPath = join(projectRoot, "package.json");
    let fromPackage = 0;
    const signals: Array<{ signal: string; weight: number; artifact?: string }> = [];
    if (existsSync(pkgPath)) {
      const parsed = parseJson(await readFile(pkgPath, "utf8"));
      if (parsed.ok && isRecord(parsed.value)) {
        const deps = {
          ...((parsed.value["dependencies"] as Record<string, string>) ?? {}),
          ...((parsed.value["devDependencies"] as Record<string, string>) ?? {}),
        };
        if (GRAPHQL_PACKAGES.some((name) => deps[name])) {
          fromPackage = 0.8;
          signals.push({ signal: "package.json declara un paquete GraphQL", weight: 0.8, artifact: "package.json" });
        }
      }
    }

    // f00011 S4: lockfile como bonus de runtime. Se acumula en
    // `signals` para que aparezca en `evidence` independientemente
    // de la rama que termine devolviendo el resultado. Sumamos al
    // final para que un lockfile no pueda tapar una ausencia de
    // framework — la detección por `package.json` o esquema va
    // siempre delante.
    for (const lock of lockfileSignals(projectRoot)) signals.push(lock);

    // Un `.graphql` con `type Query` es la señal más fuerte que hay: no
    // depende del ecosistema ni del gestor de paquetes, así que también
    // reconoce un esquema de Go, Python o Java.
    const schemas = await collectFiles(projectRoot, isSchemaFile);
    if (schemas.length === 0) {
      return signals.length > 0
        ? withEvidence(fromPackage, signals)
        : emptyResult(0);
    }
    for await (const entry of readFilesInOrder(schemas)) {
      const text = entry.text;
      if (/\btype\s+(Query|Mutation)\b/.test(text)) {
        return withEvidence(1, [
          { signal: `Esquema GraphQL con type Query/Mutation (${entry.path})`, weight: 1, artifact: entry.path },
          ...signals,
        ]);
      }
    }
    return signals.length > 0
      ? withEvidence(Math.max(fromPackage, 0.5), signals)
      : emptyResult(0.5);
  }

  async resolve(projectRoot: string): Promise<IProjectMatch> {
    const artifacts: string[] = [];
    if (existsSync(join(projectRoot, "package.json"))) artifacts.push("package.json");
    for (const file of await collectFiles(projectRoot, isSchemaFile)) {
      artifacts.push(relative(projectRoot, file));
    }
    return { framework: "graphql", projectRoot, artifacts };
  }
}

/** Un campo de `type Query` o `type Mutation`. */
interface IOperation {
  readonly kind: "query" | "mutation";
  readonly name: string;
  /** Argumentos declarados, con su tipo tal cual está en el esquema. */
  readonly args: ReadonlyArray<{ name: string; type: string }>;
  readonly returns: string;
}

/** Comentarios `#` y descripciones `"""…"""` fuera del camino. */
export function stripGraphQlComments(source: string): string {
  return source
    .replace(/"""[\s\S]*?"""/g, " ")
    .replace(/^\s*#.*$/gm, "");
}

/**
 * El cuerpo de un `type X { … }`, con las llaves balanceadas.
 *
 * `indexOf("}")` no vale: un campo puede llevar un tipo con llaves en su
 * descripción, y sobre todo un esquema con varios tipos cortaría en el
 * primer cierre que encuentre.
 */
function typeBody(source: string, typeName: string): string | null {
  const header = new RegExp(`\\btype\\s+${typeName}\\b[^{]*\\{`).exec(source);
  if (!header) return null;
  const open = header.index + header[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Recoge los escalares personalizados declarados en el esquema con la
 * directiva `scalar Nombre`. Audit 2026-09-04 P1 #4.
 *
 * Un `scalar DateTime` declarado por el proyecto debe ir al conjunto
 * de escalares —no admite selección de campos—, si no el cuerpo
 * generado pediría `now { __typename }` y la respuesta fallaría.
 */
function collectCustomScalars(source: string): void {
  const cleaned = stripGraphQlComments(source);
  const re = /^\s*scalar\s+(\w+)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m[1]) registerCustomScalar(m[1]);
  }
}

/**
 * Los campos de un bloque de tipo.
 *
 * Un campo es `nombre(args): Tipo`. Los argumentos pueden traer valores
 * por defecto y tipos anidados, así que se recorta por paréntesis
 * balanceados en vez de por regex.
 */
export function parseOperations(
  source: string,
  kind: "query" | "mutation",
): IOperation[] {
  const clean = stripGraphQlComments(source);
  // Antes de extraer operaciones, recogemos los escalares
  // personalizados del esquema completo. Si no, `parseOperations`
  // aislado por tipo no vería nunca las directivas `scalar X` que
  // están fuera del bloque `type Query` / `type Mutation`.
  collectCustomScalars(clean);
  const body = typeBody(clean, kind === "query" ? "Query" : "Mutation");
  if (body === null) return [];

  const out: IOperation[] = [];
  const fieldRe = /(\w+)\s*(\(([\s\S]*?)\))?\s*:\s*([\w[\]!]+)/g;
  let match: RegExpExecArray | null;
  while ((match = fieldRe.exec(body)) !== null) {
    const name = match[1] ?? "";
    const rawArgs = match[3] ?? "";
    const returns = match[4] ?? "";
    if (!name) continue;

    const args: Array<{ name: string; type: string }> = [];
    for (const arg of rawArgs.split(",")) {
      const parsed = /(\w+)\s*:\s*([\w[\]!]+)/.exec(arg);
      if (parsed?.[1] && parsed[2]) args.push({ name: parsed[1], type: parsed[2] });
    }
    out.push({ kind, name, args, returns });
  }
  return out;
}

/**
 * La consulta lista para mandar.
 *
 * Los argumentos van como **variables** y no incrustados en el texto:
 * es lo que permite cambiarlos desde el panel de Postman sin editar la
 * consulta, y lo que hace que un `String!` no acabe sin comillas.
 */
export function buildQueryDocument(op: IOperation): string {
  const declaration =
    op.args.length > 0
      ? `(${op.args.map((a) => `$${a.name}: ${a.type}`).join(", ")})`
      : "";
  const call =
    op.args.length > 0
      ? `(${op.args.map((a) => `${a.name}: $${a.name}`).join(", ")})`
      : "";
  // Un objeto necesita selección de campos y un escalar no la admite:
  // ponérsela a un `String!` produce una consulta **inválida**, que es
  // peor que no ponerla.
  //
  // Los escalares que trae GraphQL de serie empiezan por mayúscula igual
  // que los objetos, así que no basta con mirar la primera letra: hay que
  // nombrarlos. Un escalar propio (`DateTime`, `JSON`) no se puede
  // distinguir de un objeto sin resolver el esquema entero, y en la duda
  // se pide `__typename` — que existe en cualquier objeto y hace la
  // consulta válida.
  const bare = op.returns.replace(/[[\]!]/g, "");
  const selection = isScalarType(bare) ? "" : " {\n    __typename\n  }";
  return `${op.kind} ${op.name}${declaration} {\n  ${op.name}${call}${selection}\n}`;
}

/** Valor de ejemplo para una variable, por su tipo de GraphQL. */
function exampleForType(type: string): unknown {
  const bare = type.replace(/[[\]!]/g, "");
  if (type.startsWith("[")) return [];
  switch (bare) {
    case "Int":
      return 1;
    case "Float":
      return 1.0;
    case "Boolean":
      return true;
    case "ID":
      return "1";
    case "String":
      return "texto";
    default:
      // Audit 2026-09-04 P1 #4: si es un escalar personalizado
      // declarado por el esquema, devolvemos un string placeholder
      // (los escalares custom suelen serializar como string: `DateTime`,
      // `UUID`, `EmailAddress`). Si no, es un input type propio: un
      // objeto vacío es lo honesto, porque sus campos están en otra
      // parte del esquema y adivinarlos sería inventar.
      return isScalarType(bare) ? "valor" : {};
  }
}

export class GraphQlRouteScanner implements IRouteScanner {
  readonly framework = "graphql" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "graphql";
  }

  async scan(match: IProjectMatch): Promise<IScanResult> {
    // Audit 2026-09-04 P1 #5 (embedded SDL): antes el scanner solo
    // miraba `.graphql`/`.gql`, pero un proyecto server-side puede
    // declarar el esquema inline con `gql\`...\``. Si el servidor no
    // tiene ningún `.graphql` en disco, el scanner devolvía 0
    // operaciones. Ahora recorre además `.ts`/`.js`/`.tsx`/`.jsx`
    // y extrae los bloques `gql\`…\`` antes de aplicar el parser.
    const schemaFiles = await collectFiles(match.projectRoot, isSchemaFile);
    const sourceFiles = await collectFiles(match.projectRoot, isSourceJsTsFile);
    const routes: ParsedRoute[] = [];
    const seen = new Set<string>();

    for await (const { path, text } of readFilesInOrder(schemaFiles)) {
      const sourceFile = relative(match.projectRoot, path);
      const extracted = extractEmbeddedSdl(text);
      for (const sdl of [text, ...extracted]) {
        for (const op of scanSchema(sdl, sourceFile, seen, routes)) {
          routes.push(op);
        }
      }
    }

    // Embedded SDL: extraer bloques `gql\`...\`` de fuentes TS/JS.
    // El primer esquema `.graphql` que contenga `type Query` ya
    // cuenta como servidor; este paso es complementario y solo añade
    // operaciones nuevas (el `seen` dedupe evita duplicados).
    for await (const { path, text } of readFilesInOrder(sourceFiles)) {
      const sourceFile = relative(match.projectRoot, path);
      for (const sdl of extractEmbeddedSdl(text)) {
        for (const op of scanSchema(sdl, sourceFile, seen, routes)) {
          routes.push(op);
        }
      }
    }
    return { routes: routes };
  }
}

/**
 * Extrae los bloques `gql\`…\`` y `graphql\`…\`` de un fichero TS/JS.
 *
 * Audit 2026-09-04 P1 #5. Soporta backticks balanceados (no permite
 * `${...}` interpolation en el interior, porque rompería la lógica de
 * llaves; pero si la tiene, extrae lo que pueda y deja el resto como
 * comentario vacío — comportamiento honesto).
 */
export function extractEmbeddedSdl(source: string): string[] {
  const out: string[] = [];
  const re = /(?:gql|graphql)\s*`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const start = m.index + m[0].length;
    // Encuentra el backtick de cierre, contando llaves para tolerar
    // `${...}` (que se reemplaza por literal vacío en el cuerpo).
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
      else if (ch === "`" && depth === 0) {
        end = i;
        break;
      }
    }
    if (end === -1) continue;
    const raw = source.slice(start, end);
    // Quita las interpolaciones `${…}` reemplazándolas por literal
    // vacío, que es lo que el parser espera (los tipos SDL no
    // contienen interpolaciones de runtime).
    const cleaned = raw.replace(/\$\{[\s\S]*?\}/g, "");
    out.push(cleaned);
    re.lastIndex = end + 1;
  }
  return out;
}

/**
 * Saca operaciones (Query/Mutation) de un texto SDL y las añade a
 * `routes` si no están en `seen`. Devuelve las añadidas para que el
 * caller encadene.
 */
function scanSchema(
  sdl: string,
  sourceFile: string,
  seen: Set<string>,
  _routes: ParsedRoute[],
): ParsedRoute[] {
  const added: ParsedRoute[] = [];
  for (const kind of ["query", "mutation"] as const) {
    for (const op of parseOperations(sdl, kind)) {
      const seenKey = `${op.kind}:${op.name}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);

      const variables = Object.fromEntries(
        op.args.map((a) => [a.name, exampleForType(a.type)]),
      );
      const route: ParsedRoute = {
        method: "POST",
        uri: DEFAULT_ENDPOINT,
        rawUri: DEFAULT_ENDPOINT,
        sourceFile,
        lineNumber: 1,
        prefixChain: [],
        displayName: `${op.kind} ${op.name}`,
        description: `${op.kind} \`${op.name}\` → \`${op.returns}\``,
        tags: [op.kind === "query" ? "Queries" : "Mutations"],
        body: {
          query: buildQueryDocument(op),
          variables,
        },
      };
      added.push(route);
    }
  }
  return added;
}

// `scanSchema` se mantiene como helper local (no se exporta) — solo
// lo usa el `scan()` del propio scanner.
