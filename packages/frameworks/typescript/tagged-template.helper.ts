/**
 * `collectTaggedTemplates` — un *TaggedTemplateExpression* del AST TS,
 * visto desde el adaptador de frameworks.
 *
 * (a00015 S1) Sustituye a `extractEmbeddedSdl` en `graphql.scanner.ts`.
 * La diferencia con el regex anterior:
 *
 *   - El regex leía `gql\`...\`` sobre `text` y matcheaba cualquier
 *     cosa que pareciera un backtick abierto — incluyendo comentarios
 *     (`// gql\`...\``) y strings literales (`"gql\`...\``"). Falsos
 *     positivos típicos: un README dentro del código o un help text
 *     tipo "escribe gql\`type Query { ... }\`".
 *   - Esta implementación pide el árbol a `@babel/parser` (el mismo
 *     parser que usa `packages/core/language-frontends/typescript`)
 *     y devuelve los `TaggedTemplateExpression` que Babel reconoce
 *     como tales. Un `// gql\`...\`` está dentro de un nodo
 *     `CommentLine` y nunca aparece como
 *     `TaggedTemplateExpression`; un `"gql\`...\``" está dentro de
 *     un `StringLiteral` y solo el nodo externo es visible.
 *
 * No es un parser nuevo: `@babel/parser` ya está en el lockfile
 * (`@babel/parser@7.29.8`) por el frontend TS. Lo único que hace este
 * módulo es exponer una vista distinta del mismo árbol — los
 * `TaggedTemplateExpression` que el frontend descartó cuando se quedó
 * solo con `imports / symbols / classes / methodCalls / assignments /
 * decorators`. Reusar el parser es el invariante del proyecto (a00010
 * S7 — `core` no importa de `frameworks`, pero ambos comparten
 * `@babel/parser`).
 *
 * Por qué NO se añade `taggedTemplates` al `TSFile` del frontend:
 *   - El frontend es agnóstico de GraphQL. Un scanner que quiere
 *     `gql\`...\`` y otro que quiere `html\`...\`` no necesitan
 *     acoplarse al contrato del frontend: cada adapter de framework
 *     monta su propio consumidor encima del AST crudo.
 *   - Los 6 scanners que ya consumen el frontend (Express, NestJS,
 *     Fastify, Hono, Next.js, tRPC) no se enteran del cambio — siguen
 *     viendo el mismo `TSFile` que antes.
 *
 * Lo que el módulo NO hace (a00015 non-goals):
 *   - No resuelve tipos (`<T>`).
 *   - No sigue imports entre ficheros.
 *   - No parsea el contenido del template (es SDL sin tocar; el
 *     scanner GraphQL lo pasa por su propio parser SDL).
 *   - No reemplaza `extractEmbeddedSdl` directamente: este módulo es
 *     una *forma*; el adaptador que une esta forma con el scanner
 *     GraphQL vive en `S2` (`graphql-embedded.adapter.ts`).
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { parse as babelParse, type ParserPlugin } from "@babel/parser";
import type { IParseDiagnostic } from "../../contracts/interfaces/core/scanner.interface.js";
import { collectFiles, isSourceJsTsFile } from "../../core/helpers/fs-walk.helper.js";

/**
 * `ITaggedTemplate` se importa desde
 * `contracts/interfaces/frameworks/typescript.interface.ts`
 * (el contrato), que es donde `lint:contracts` lo exige. El
 * helper re-exporta el tipo para que los consumidores no tengan
 * que conocer la ruta de contracts.
 */
import type { ITaggedTemplate } from "../../contracts/interfaces/frameworks/typescript.interface.js";

export type { ITaggedTemplate };

/** Forma mínima del nodo Babel que este módulo necesita reconocer. */
interface BabelNode {
  readonly type: string;
  readonly start?: number | null;
  readonly end?: number | null;
  readonly [key: string]: unknown;
}

/** Trata un `unknown` como BabelNode (cast permisivo, mismo patrón que el frontend). */
function asBabelNode(value: unknown): BabelNode {
  return value as BabelNode;
}

/** Array de unknowns → array de BabelNodes. */
function asArray(value: unknown): ReadonlyArray<BabelNode> {
  return Array.isArray(value) ? (value as ReadonlyArray<BabelNode>) : Array<BabelNode>();
}

/**
 * Indica si el archivo es JSX/TSX — mismo criterio que el frontend
 * (`packages/core/language-frontends/typescript/typescript.parser.ts`).
 * Sin esto, Babel rechaza `<Foo />` con syntax error y el scanner
 * pierde el archivo entero.
 */
function isJsxFile(filename: string): boolean {
  return filename.endsWith(".tsx") || filename.endsWith(".jsx");
}

/**
 * Resuelve el `tag` y el `importBinding` de una `TaggedTemplateExpression`.
 *
 * Tres formas que reconoce:
 *   - `gql\`...\``              → tag = "gql"
 *   - `graphql\`...\``          → tag = "graphql"
 *   - `Foo.Bar\`...\``          → tag = "Bar" (la propiedad del MemberExpression)
 *
 * `importBinding` solo se rellena cuando el tag es un Identifier
 * desnudo (no una llamada ni un MemberExpression): en esos casos el
 * identifier ES el binding local (`import { gql }`). En las demás
 * formas no hay un binding único y se deja undefined — los adapters
 * que necesitan resolver el módulo origen lo harán en otro slice.
 */
function readTag(callee: BabelNode): { tag: string; importBinding?: string } | null {
  if (callee.type === "Identifier") {
    const name = String(callee.name ?? "");
    if (!name) return null;
    return { tag: name, importBinding: name };
  }
  if (callee.type === "MemberExpression") {
    const property = asBabelNode(callee["property"]);
    const propName = String(property.name ?? property.value ?? "");
    if (!propName) return null;
    // No hay un binding único: el tag es el nombre del método
    // (`graphql` en `Foo.graphql\`...\``). El adapter puede usar `tag`
    // directamente si solo le importa el nombre corto.
    return { tag: propName };
  }
  if (callee.type === "CallExpression") {
    // `graphql(...)` no es un tagged template; ignoramos.
    return null;
  }
  return null;
}

/**
 * Recorre el árbol de Babel en DFS y emite una `ITaggedTemplate` por
 * cada `TaggedTemplateExpression` encontrada.
 *
 * Mismo patrón que `walk` en el frontend: visita TODO sin podar, y los
 * collectors deciden qué les interesa. Aquí nos interesa todo
 * `TaggedTemplateExpression`, sin filtrar por tag — el filtrado por
 * tag lo hace el adapter (S2), que es quien conoce la lista de tags
 * que le importan (`gql`, `graphql`, ...).
 */
function walkForTaggedTemplates(
  body: ReadonlyArray<BabelNode>,
  sourceFile: string,
  out: ITaggedTemplate[],
): void {
  // Inicializamos el stack en orden inverso para que el primer
  // nodo de `body` se procese primero al hacer `pop()` — el
  // resultado es un recorrido top-down por el archivo, que es lo
  // que el scanner SDL espera para poblar `customScalars` antes de
  // procesar operaciones.
  const stack: BabelNode[] = [...body].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;

    if (node.type === "TaggedTemplateExpression") {
      const tagNode = asBabelNode(node["tag"]);
      const tagInfo = readTag(tagNode);
      if (tagInfo) {
        const quasi = asBabelNode(node["quasi"]);
        const start = typeof node.start === "number" ? node.start : 0;
        const end = typeof node.end === "number" ? node.end : start;
        // El AST de Babel expone el cuerpo del template como
        // `quasi.quasis: TemplateElement[]` — un array de
        // fragmentos separados por interpolaciones (`${…}`). Cada
        // `TemplateElement` lleva `value.raw` (la forma textual
        // original, con `\n` literales) y `value.cooked` (la forma
        // ya evaluada). El scanner SDL prefiere `raw` para no perder
        // saltos de línea ni escapes — que es lo que el parser SDL
        // espera ver.
        const quasis = asArray(quasi["quasis"]);
        const raw = quasis
          .map((elem) => {
            // `value` es un objeto `{ raw: string, cooked?: string }`
            // — Babel expone ambos en `TemplateElement`. El cast a
            // `Record<string, unknown>` es la forma permisiva que
            // comparte el patrón del frontend (a00010 S7): sin
            // importar `@babel/types`.
            const value = elem["value"] as Record<string, unknown> | undefined;
            const rawText = value?.["raw"];
            return typeof rawText === "string" ? rawText : "";
          })
          .join("");
        out.push({
          tag: tagInfo.tag,
          ...(tagInfo.importBinding !== undefined
            ? { importBinding: tagInfo.importBinding }
            : {}),
          raw,
          range: { start, end },
          sourceFile,
        });
      }
    }

    // Hijos: cualquier campo que sea objeto/array con `type`. Los
    // metemos en orden INVERSO al stack para que el primer hijo
    // salga primero al hacer `pop()` — el resultado es un recorrido
    // top-down por el archivo, ( el el scanner SDL pueda poblar
    // `customScalars` antes de procesar operaciones (segunda
    // revisión del audit `2026-09-04 P1 #12`).
    const children: BabelNode[] = [];
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && "type" in item) {
            children.push(asBabelNode(item));
          }
        }
      } else if (value && typeof value === "object" && "type" in value) {
        children.push(asBabelNode(value));
      }
    }
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) stack.push(child);
    }
  }
}

/**
 * Parsea un archivo TS/JS y devuelve sus `TaggedTemplateExpression`.
 *
 * Si Babel no puede parsear el archivo, registra el motivo en
 * `diagnostics` (si el array vino) y devuelve `[]` — el caller decide
 * qué hacer. Es el mismo contrato que `parseModule` en el frontend
 * (a00011 C-7 / B-rev-13): un archivo con sintaxis rara no aborta el
 * scan, pero el fallo queda visible para quien quiera reportarlo.
 */
export function collectTaggedTemplatesFromSource(
  source: string,
  filename: string,
  diagnostics?: Array<IParseDiagnostic>,
): ITaggedTemplate[] {
  const plugins: ParserPlugin[] = ["typescript", "decorators"];
  if (isJsxFile(filename)) plugins.push("jsx");

  try {
    const ast = babelParse(source, {
      sourceType: "module",
      allowImportExportEverywhere: true,
      plugins: [...plugins],
      errorRecovery: true,
    });
    const body = asArray(ast.program["body"]);
    const out: ITaggedTemplate[] = [];
    walkForTaggedTemplates(body, filename, out);
    return out;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    diagnostics?.push({ file: filename, severity: "error", reason });
    return [];
  }
}

/**
 * Recorre los TS/JS fuente de `projectRoot` y devuelve todas las
 * `TaggedTemplateExpression` que encuentre.
 *
 * Usa `collectFiles(projectRoot, isSourceJsTsFile)` — el mismo
 * helper que `express.scanner.ts` y que `graphql.scanner.ts` ya usan
 * para localizar archivos TS/JS — así que respeta los mismos excludes
 * (`node_modules`, `dist`, etc.) sin reinventar la rueda.
 *
 * `diagnostics` (opcional) recibe los archivos que el parser no pudo
 * digerir. Si no se pasa, los fallos se tragan silenciosamente — es
 * la forma "degradable" que usan los tests que solo quieren verificar
 * la forma del árbol.
 */
export async function collectTaggedTemplates(
  projectRoot: string,
  diagnostics?: Array<IParseDiagnostic>,
): Promise<ITaggedTemplate[]> {
  const files = await collectFiles(projectRoot, isSourceJsTsFile);
  const out: ITaggedTemplate[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      // El archivo desapareció entre `collectFiles` y `readFile` (un
      // test que escribe y borra, o un editor en medio de un save).
      // No abortamos el scan por eso.
      continue;
    }
    // `relative` solo para que `sourceFile` sea legible en logs; el
    // adapter no lo usa y, si lo necesita, puede resolverlo él mismo.
    // Si `relative` falla (path fuera de projectRoot), caemos al
    // path absoluto — sigue siendo un identificador válido y permite
    // al caller saber de qué archivo viene el template.
    const rel = relative(projectRoot, file) || file;
    out.push(...collectTaggedTemplatesFromSource(text, rel, diagnostics));
  }
  return out;
}