/**
 * `TSLiteral` — la forma normalizada de un literal que aparece en una
 * llamada o asignación TS/JS.
 *
 * Es el tipo de los argumentos de `TSMethodCall.args`, de
 * `TSAssignment.value` y de `TSDecorator.args`. Cada scanner extrae
 * los que le interesan (paths, prefixes, body schemas) y descarta el
 * resto — por eso es un **discriminated union** y no un objeto abierto.
 *
 * El modelo es deliberadamente plano: no hay objetos anidados como
 * nodos, solo `objectShape: [{ key, literal }]`. Los scanners que
 * necesitan tipos anidados (Fastify con su JSON Schema, Hono con sus
 * validators) traducen el `objectShape` a su propio modelo. Aquí
 * basta con que `key` sea un string literal y `literal` vuelva a ser
 * un `TSLiteral` — recursión sin recursión infinita.
 *
 * (a00010 S7 — slice AST TypeScript)
 */

/**
 * `bodyRange` lleva el offset (en bytes, 0-based) del cuerpo de la
 * arrow function. El adapter lo usa para extraer el contenido entre
 * `start` y `end` y procesarlo por separado (buscar `Schema.parse(...)`
 * en el cuerpo, parsear el `req.body`, etc.).
 *
 * Aparece en `TSLiteral` para `kind: "arrow"` y se reusa arriba en
 * `TSMethodCall.bodyRange` cuando el último argumento de una llamada
 * es una arrow — el adapter puede leerlo desde el methodCall sin
 * descender al literal.
 */
export interface TSLiteralBodyRange {
  readonly start: number;
  readonly end: number;
}

/** Tipo discrimado del literal. */
export type TSLiteralKind =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "undefined"
  | "object"
  | "array"
  | "identifier"
  | "arrow"
  | "unknown";

/**
 * Un literal en una posición del AST. El campo que aplica depende de
 * `kind`:
 *
 *   - `string` / `number` / `boolean` → `value`.
 *   - `null` / `undefined` → ningún campo adicional (el kind basta).
 *   - `object` → `objectShape: [{ key, literal }]` (recursivo).
 *   - `array` → `arrayItems: TSLiteral[]` (recursivo).
 *   - `identifier` → `identifierName` (el nombre del símbolo).
 *   - `arrow` → `bodyRange` (offset del cuerpo).
 *   - `unknown` → cuando el parser ve una expresión que no encaja en
 *     ninguna de las anteriores (`new Foo(...)`, llamadas anidadas,
 *     spreads). El adapter decide si la ignora o la procesa aparte.
 *
 * `value` es `string | number | boolean | undefined`. `undefined` solo
 * aparece en `kind: "boolean"` con `value: false` no — ahí va el
 * literal `false`. Si el campo falta en una string, es porque el kind
 * no lo necesita; el adapter lo sabe por el discriminador.
 */
export interface TSLiteral {
  readonly kind: TSLiteralKind;
  readonly value?: string | number | boolean | undefined;
  readonly identifierName?: string;
  readonly objectShape?: ReadonlyArray<{ readonly key: string; readonly literal: TSLiteral }>;
  readonly arrayItems?: ReadonlyArray<TSLiteral>;
  readonly bodyRange?: TSLiteralBodyRange;
}