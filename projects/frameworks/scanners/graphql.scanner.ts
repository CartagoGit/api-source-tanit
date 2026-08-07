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
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type {
  IProjectMatch,
  IProjectScanner,
  IRouteScanner,
  ParsedRoute,
} from "../../core/contracts/scanner.interface.js";
import { collectFiles } from "../../core/helpers/fs-walk.helper.js";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";

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

/** Ficheros de esquema. */
function isSchemaFile(name: string): boolean {
  return name.endsWith(".graphql") || name.endsWith(".gql");
}

export class GraphQlProjectScanner implements IProjectScanner {
  readonly framework = "graphql" as const;

  async detect(projectRoot: string): Promise<number> {
    const pkgPath = join(projectRoot, "package.json");
    let fromPackage = 0;
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        if (GRAPHQL_PACKAGES.some((name) => deps[name])) fromPackage = 0.8;
      } catch {
        fromPackage = 0;
      }
    }

    // Un `.graphql` con `type Query` es la señal más fuerte que hay: no
    // depende del ecosistema ni del gestor de paquetes, así que también
    // reconoce un esquema de Go, Python o Java.
    const schemas = await collectFiles(projectRoot, isSchemaFile);
    if (schemas.length === 0) return fromPackage;
    for await (const { text } of readFilesInOrder(schemas)) {
      if (/\btype\s+(Query|Mutation)\b/.test(text)) return 1;
    }
    return Math.max(fromPackage, 0.5);
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
  const selection = BUILTIN_SCALARS.has(bare) ? "" : " {\n    __typename\n  }";
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
      // Un tipo de entrada propio: un objeto vacío es lo honesto, porque
      // sus campos están en otra parte del esquema y adivinarlos sería
      // inventar.
      return {};
  }
}

export class GraphQlRouteScanner implements IRouteScanner {
  readonly framework = "graphql" as const;

  matches(match: IProjectMatch): boolean {
    return match.framework === "graphql";
  }

  async scan(match: IProjectMatch): Promise<ParsedRoute[]> {
    const files = await collectFiles(match.projectRoot, isSchemaFile);
    const routes: ParsedRoute[] = [];
    const seen = new Set<string>();

    for await (const { path, text } of readFilesInOrder(files)) {
      const sourceFile = relative(match.projectRoot, path);
      for (const kind of ["query", "mutation"] as const) {
        for (const op of parseOperations(text, kind)) {
          // Un esquema partido en varios ficheros puede repetir el tipo
          // `Query` con `extend type`: la operación es la misma.
          if (seen.has(op.name)) continue;
          seen.add(op.name);

          const variables = Object.fromEntries(
            op.args.map((a) => [a.name, exampleForType(a.type)]),
          );
          routes.push({
            // GraphQL va **siempre** por POST, también las consultas: el
            // GET existe pero casi nadie lo habilita, y una colección que
            // no funciona al primer Send no sirve.
            method: "POST",
            uri: DEFAULT_ENDPOINT,
            rawUri: DEFAULT_ENDPOINT,
            sourceFile,
            lineNumber: 1,
            prefixChain: [],
            displayName: `${op.kind} ${op.name}`,
            description: `${op.kind} \`${op.name}\` → \`${op.returns}\``,
            // La carpeta separa consultas de mutaciones, que es la
            // división que importa: unas leen y otras escriben.
            tags: [op.kind === "query" ? "Queries" : "Mutations"],
            body: {
              query: buildQueryDocument(op),
              variables,
            },
          });
        }
      }
    }
    return routes;
  }
}
