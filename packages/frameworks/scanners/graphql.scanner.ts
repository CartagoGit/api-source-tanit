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
import { collectFiles } from "../../core/helpers/fs-walk.helper.js";
import { effectiveProjectRoot, rawProjectRoot } from "../../core/discovery/effective-project-root.helper.js";
import { readFilesInOrder } from "../../core/helpers/read-files.helper.js";
import { isRecord, parseJson } from "../../core/helpers/parse-json.helper.js";
import { collectTaggedTemplates } from "../typescript/tagged-template.js";
import { collectEmbeddedSdl } from "./graphql-embedded.adapter.js";

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
 * Devuelve true si el tipo (sin `[`, `]`, `!`) es escalar.
 *
 * Audit 2026-09-04 (segunda revisión): el `customScalars` que tenía
 * antes era un Set a nivel de módulo. Dos scans consecutivos
 * (especialmente en `Promise.all` con proyectos distintos)
 * contaminaban sus escalares: el segundo proyecto heredaba los
 * `scalar X` del primero. El contrato `IScanResult` exige
 * explícitamente que el scanner no guarde estado entre invocaciones
 * (es lo que justifica que el `scan()` reciba `match` por argumento
 * y devuelva rutas por valor). Ahora `customScalars` es **local a
 * cada `scan()`** y se pasa por argumento a las funciones puras.
 */
function isScalarType(type: string, customScalars: ReadonlySet<string>): boolean {
  const bare = type.replace(/[[\]!]/g, "");
  return BUILTIN_SCALARS.has(bare) || customScalars.has(bare);
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
    // Audit 2ª revisión #14: antes, si había archivos `.graphql`
    // pero ninguno contenía `type Query/Mutation`, devolvíamos
    // `emptyResult(0.5)`. Un proyecto frontend con solo fragments o
    // tipos auxiliares acababa marcado como servidor GraphQL. Ahora
    // **solo el manifest puntúa** cuando no hay `type Query`. Los
    // archivos `.graphql` sueltos ya no son evidencia de servidor.
    for await (const entry of readFilesInOrder(schemas)) {
      const text = entry.text;
      if (/\btype\s+(Query|Mutation)\b/.test(text)) {
        return withEvidence(1, [
          { signal: `Esquema GraphQL con type Query/Mutation (${entry.path})`, weight: 1, artifact: entry.path },
          ...signals,
        ]);
      }
    }
    // Sin Query/Mutation: si el manifest no puntúa, no es un
    // servidor GraphQL (aunque haya archivos `.graphql`). Bajamos a
    // 0 para no contaminar la detección.
    return signals.length > 0
      ? withEvidence(fromPackage, signals)
      : emptyResult(0);
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
 * directiva `scalar Nombre`. Audit 2026-09-04 P1 #4 + segunda revisión.
 *
 * Devuelve un Set NUEVO por invocación: el caller es el dueño del
 * estado y decide cuándo se inicializa. Esto cumple el contrato
 * `IScanResult` (el scanner no guarda estado entre invocaciones) y
 * permite que `Promise.all([scan(A), scan(B)])` no contamine B con
 * los escalares de A.
 */
export function collectCustomScalars(source: string): Set<string> {
  const out = new Set<string>();
  const cleaned = stripGraphQlComments(source);
  // Reconoce `scalar X` y `scalar X @directive(...)` (audit
  // segunda revisión #13). El bloque tras `scalar` puede llevar
  // directivas antes del salto de línea; si las hay, no se
  // contabiliza el nombre.
  const re = /^\s*scalar\s+(\w+)(?:\s+@\w+[\s\S]*?)?$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m[1] && !BUILTIN_SCALARS.has(m[1])) out.add(m[1]);
  }
  return out;
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
export function buildQueryDocument(
  op: IOperation,
  customScalars: ReadonlySet<string> = new Set<string>(),
): string {
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
  const selection = isScalarType(bare, customScalars)
    ? ""
    : " {\n    __typename\n  }";
  return `${op.kind} ${op.name}${declaration} {\n  ${op.name}${call}${selection}\n}`;
}

/** Valor de ejemplo para una variable, por su tipo de GraphQL. */
function exampleForType(
  type: string,
  customScalars: ReadonlySet<string>,
): unknown {
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
      return isScalarType(bare, customScalars) ? "valor" : {};
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
    const schemaFiles = await collectFiles(effectiveProjectRoot(match), isSchemaFile);

    // a00015 S1+S2+S3: el scanner ahora delega la extracción
    // embedded SDL en el AST TS (collectTaggedTemplates →
    // collectEmbeddedSdl). Antes un regex sobre cada fichero
    // (`extractEmbeddedSdl(text)`) matcheaba falsos positivos en
    // comentarios (`// gql\`...\``) y strings (`"gql\`...\``) — ver
    // propuesta a00015. El AST no se equivoca: un
    // TaggedTemplateExpression solo aparece como tal cuando Babel
    // reconoce la sintaxis real.
    //
    // Los SDL extraídos se devuelven como string[] en el orden
    // top-down de los TaggedTemplateExpression: el scanner los
    // pasa por `collectCustomScalars` y por `scanSchema` en ese
    // mismo orden. `customScalars` debe poblarse antes de generar
    // operaciones (segunda revisión del audit 2026-09-04 P1 #12).
    const embeddedSdl: string[] = collectEmbeddedSdl(
      await collectTaggedTemplates(effectiveProjectRoot(match)),
    );

    // Audit segunda revisión #10 (custom scalars + ciclo de scan):
    // dos pasadas. La primera recoge todos los escalares
    // personalizados del proyecto entero (no solo del bloque
    // `type Query`); la segunda genera las operaciones con ese Set
    // como referencia. Esto cierra el bug "scalar DateTime en
    // 99-scalars.graphql no se ve cuando se parsea 00-query.graphql
    // primero". El Set es local a este `scan()` — nunca se comparte
    // entre invocaciones (segunda revisión, P1).
    const customScalars = new Set<string>();
    for await (const { text } of readFilesInOrder(schemaFiles)) {
      for (const scalar of collectCustomScalars(text)) customScalars.add(scalar);
    }
    for (const sdl of embeddedSdl) {
      for (const scalar of collectCustomScalars(sdl)) customScalars.add(scalar);
    }

    const routes: ParsedRoute[] = [];
    const seen = new Set<string>();

    for await (const { path, text } of readFilesInOrder(schemaFiles)) {
      const sourceFile = relative(rawProjectRoot(match), path);
      for (const op of scanSchema(
        text,
        sourceFile,
        seen,
        routes,
        customScalars,
      )) {
        routes.push(op);
      }
    }

    // Embedded SDL: bloques `gql\`...\`` AST-derived de TS/JS. El
    // primer esquema `.graphql` que contenga `type Query` ya
    // cuenta como servidor; este paso es complementario y solo añade
    // operaciones nuevas (el `seen` dedupe evita duplicados).
    for (const sdl of embeddedSdl) {
      for (const op of scanSchema(sdl, "<embedded>", seen, routes, customScalars)) {
        routes.push(op);
      }
    }
    return { routes: routes };
  }
}

/**
 * Saca operaciones (Query/Mutation) de un texto SDL y las añade a
 * `routes` si no están en `seen`. Devuelve las añadidas para que el
 * caller encadene.
 *
 * `customScalars` lo aporta el caller (típicamente el `scan()` del
 * scanner) tras una pasada previa sobre todo el SDL del proyecto —
 * es lo que evita el bug de la segunda revisión #12 ("custom scalar
 * en otro fichero no se ve si se procesa primero el fichero de
 * operaciones").
 */
function scanSchema(
  sdl: string,
  sourceFile: string,
  seen: Set<string>,
  _routes: ParsedRoute[],
  customScalars: ReadonlySet<string>,
): ParsedRoute[] {
  const added: ParsedRoute[] = [];
  for (const kind of ["query", "mutation"] as const) {
    for (const op of parseOperations(sdl, kind)) {
      const seenKey = `${op.kind}:${op.name}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);

      const variables = Object.fromEntries(
        op.args.map((a) => [a.name, exampleForType(a.type, customScalars)]),
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
          query: buildQueryDocument(op, customScalars),
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
