/**
 * Contratos compartidos por el frontend TypeScript de los scanners.
 *
 * Antes estos tipos vivían al lado de las funciones que los
 * estrenaron (`packages/frameworks/typescript/tagged-template.
 * helper.ts`), pero `lint:contracts` los rechaza ahí: un tipo
 * declarado junto a su función obliga a importarla sólo para
 * tipar, y eso arrastra el árbol de helpers cuando un consumidor
 * externo (la web UI, un plugin MCP, etc.) quiere usar la forma.
 *
 * Por eso viven aquí, junto a los demás contratos de `frameworks/`.
 */

/**
 * Una `TaggedTemplateExpression` vista por un adapter.
 *
 * - `tag`: el identificador que aparece a la izquierda del
 *   backtick. Para `gql\`...\`` es `"gql"`. Si el tag es una llamada
 *   (`graphql\`...\``), `tag` se queda con el nombre del tag (`"graphql"`).
 *   Si el tag es un identificador importado (`import { gql } from ...`),
 *   `importBinding` lleva `"gql"` — que es el binding local, no el
 *   nombre del módulo del que se importa. Los adapters pueden usar
 *   `tag` o `importBinding` para filtrar; por defecto `tag` ya es
 *   el binding local.
 * - `raw`: el contenido del template tal cual está entre los
 *   backticks. Las interpolaciones `${…}` NO se resuelven (el frontend
 *   no sabe que el contenido es SDL): a00015 S4 coloca en su lugar un
 *   sentinel determinista `__TANIT_INTERP_<n>__` por cada expresión del
 *   template (numerada por ocurrencia). Así la interpolación no se
 *   borra en silencio: el scanner GraphQL detecta `hasInterpolation` y
 *   se niega a parsear ese template (emite un diagnóstico) en lugar de
 *   extraer un SDL incompleto. Cuando `hasInterpolation` no está, `raw`
 *   no contiene ningún sentinel.
 * - `hasInterpolation`: true si el template tenía al menos un
 *   `${…}` (y por tanto `raw` incluye sentinel(s)). Opcional para no
 *   romper consumidores previos (a00015 S4).
 * - `range`: rango en bytes sobre el archivo original. El start
 *   apunta al primer carácter del tag; el end apunta al último
 *   carácter del backtick de cierre (inclusive). Útil para reporting
 *   futuro, no se consume hoy.
 * - `sourceFile`: ruta absoluta del archivo donde se encontró.
 */
export interface ITaggedTemplate {
  readonly tag: string;
  readonly raw: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly importBinding?: string;
  readonly sourceFile: string;
  /** a00015 S4: ver doc de la interfaz. */
  readonly hasInterpolation?: boolean;
}
