/**
 * `TSLiteral` — the normalized shape of a literal that appears in a
 * TS/JS call or assignment.
 *
 * It is the type of the arguments of `TSMethodCall.args`, of
 * `TSAssignment.value`, and of `TSDecorator.args`. Each scanner
 * extracts the ones it cares about (paths, prefixes, body schemas)
 * and discards the rest — that is why it is a **discriminated union**
 * and not an open object.
 *
 * The model is deliberately flat: there are no nested objects as
 * nodes, only `objectShape: [{ key, literal }]`. Scanners that need
 * nested types (Fastify with its JSON Schema, Hono with its
 * validators) translate the `objectShape` to their own model. Here
 * it is enough that `key` is a string literal and `literal` is again
 * a `TSLiteral` — recursion without infinite recursion.
 *
 * (a00010 S7 — TypeScript AST slice)
 */

/**
 * `bodyRange` carries the offset (in bytes, 0-based) of the arrow
 * function's body. The adapter uses it to extract the content
 * between `start` and `end` and process it separately (search for
 * `Schema.parse(...)` inside the body, parse `req.body`, etc.).
 *
 * It appears in `TSLiteral` for `kind: "arrow"` and is reused above
 * in `TSMethodCall.bodyRange` when the last argument of a call is an
 * arrow — the adapter can read it from the methodCall without
 * descending into the literal.
 */
export interface TSLiteralBodyRange {
  readonly start: number;
  readonly end: number;
}

/** Discriminated type of the literal. */
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
 * A literal at an AST position. Which field applies depends on
 * `kind`:
 *
 *   - `string` / `number` / `boolean` → `value`.
 *   - `null` / `undefined` → no additional field (the kind suffices).
 *   - `object` → `objectShape: [{ key, literal }]` (recursive).
 *   - `array` → `arrayItems: TSLiteral[]` (recursive).
 *   - `identifier` → `identifierName` (the symbol's name).
 *   - `arrow` → `bodyRange` (body offset).
 *   - `unknown` → when the parser sees an expression that does not
 *     fit any of the above (`new Foo(...)`, nested calls, spreads).
 *     The adapter decides whether to ignore it or process it
 *     separately.
 *
 * `value` is `string | number | boolean | undefined`. `undefined`
 * only shows up for `kind: 'boolean'` — but not with `value: false`,
 * which carries the literal `false`. If the field is missing on a
 * string, it is because the kind does not need it; the adapter
 * knows that via the discriminator.
 */
export interface TSLiteral {
  readonly kind: TSLiteralKind;
  readonly value?: string | number | boolean | undefined;
  readonly identifierName?: string;
  readonly objectShape?: ReadonlyArray<{ readonly key: string; readonly literal: TSLiteral }>;
  readonly arrayItems?: ReadonlyArray<TSLiteral>;
  readonly bodyRange?: TSLiteralBodyRange;
}