/**
 * `graphql-embedded.adapter` — consume el AST TS para dar SDL embebido.
 *
 * (a00015 S2) Sustituye al `extractEmbeddedSdl(text)` de
 * `graphql.scanner.ts`, que leía cada fichero TS/JS con un regex sobre
 * `gql\`...\`` y devolvía el contenido entre backticks. El regex
 * tenía dos falsos positivos que la base de issues conocía:
 *
 *   1. `// gql\`type Query { fake: String }\`` — un comentario con
 *      código de ejemplo. El regex veía `gql\`` y devolvía el SDL
 *      ficticio.
 *   2. `"gql\`type Query { fake: String }\`"` — un string literal con
 *      la sintaxis de GraphQL como ayuda. El regex veía `gql\``
 *      dentro del string y devolvía un SDL ficticio.
 *
 * El AST no se equivoca en estos casos: un `TaggedTemplateExpression`
 * solo aparece como tal cuando el parser reconoce la sintaxis real;
 * un `// gql\`` está dentro de un `CommentLine` y un `"gql\`` está
 * dentro de un `StringLiteral`. Reusar el AST del frontend TS es el
 * invariante del proyecto (a00010 S7 — `core` no importa de
 * `frameworks`, pero ambos comparten `@babel/parser`).
 *
 * ## Forma
 *
 * El adapter es **puro**: solo proyecta los `ITaggedTemplate` que
 * coinciden con la lista de tags del scanner a strings SDL.
 *
 *   `collectEmbeddedSdl(templates, options?)` → `string[]`
 *
 * El scanner itera la lista y la pasa por su parser SDL existente
 * (`parseOperations` + `scanSchema`) — el adapter no toca el parsing
 * de SDL porque el scanner ya sabe hacerlo.
 *
 * ## Tag filtering
 *
 * Por defecto se aceptan `["gql", "graphql"]`. Es la lista que el
 * regex anterior reconocía, copiada literal del comentario que lo
 * justificaba. Si mañana aparece otro nombre (p. ej. `parsed.gql`,
 * `Foo.gql`), basta con pasarlo en `options.tags`. El adapter NO
 * case-fold ni normaliza — el scanner espera match exacto, igual
 * que el regex anterior.
 *
 * ## Interpolaciones
 *
 * El regex anterior limpiaba las interpolaciones `${...}` dejándolas
 * vacías. El AST entrega el `cooked` ya con los placeholders
 * resueltos a sus valores — pero los `gql\`...\`` reales rara vez
 * llevan interpolaciones de runtime en el cuerpo SDL (los tipos no
 * contienen variables). Cuando las hay, conservamos el texto crudo
 * tal cual; el parser SDL downstream reportará un error de sintaxis
 * honesto en vez de tragárselo. Comportamiento por defecto alineado
 * con el scanner actual.
 */
import type { ITaggedTemplate } from "../typescript/tagged-template.helper.js";

/** Tags que el scanner reconoce como etiquetas de embedded SDL. */
const DEFAULT_TAGS: ReadonlyArray<string> = ["gql", "graphql"];

/** Opciones del adapter. */
export interface ICollectEmbeddedSdlOptions {
  /** Lista de tags que se aceptan como embedded SDL. */
  readonly tags?: ReadonlyArray<string>;
}

/**
 * Devuelve los strings SDL extraídos de `templates` cuyo tag está
 * en la lista `options.tags` (o `DEFAULT_TAGS` si no se pasa).
 *
 * El orden del array de salida sigue el orden de los templates:
 * top-down por archivo, luego archivo por archivo en el orden en que
 * `collectTaggedTemplates` los devolvió. Esto es importante porque
 * el scanner usa el resultado para detectar escalares personalizados
 * ANTES de parsear operaciones (segunda revisión del audit
 * `2026-09-04 P1 #12`) — el orden top-down es lo que espera
 * `customScalars`.
 *
 * Si `templates` viene vacío devuelve `[]`. Si ningún template pasa
 * el filtro de tags, devuelve `[]`. Nunca devuelve `null`.
 */
export function collectEmbeddedSdl(
  templates: ReadonlyArray<ITaggedTemplate>,
  options: ICollectEmbeddedSdlOptions = {},
): string[] {
  const tags = options.tags ?? DEFAULT_TAGS;
  const tagSet = new Set(tags);
  const out: string[] = [];
  for (const tpl of templates) {
    if (!tagSet.has(tpl.tag)) continue;
    out.push(tpl.raw);
  }
  return out;
}