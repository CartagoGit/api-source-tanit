/**
 * `ICallExpression` — a call, described the same way in every
 * language.
 *
 * ## The problem this shape solves
 *
 * "The route is registered by `app.get("/users", handler)`" is a
 * TypeScript sentence. Python writes `app.get("/users", handler)` too,
 * but Go writes `app.Get("/users", handler)`, Java writes
 * `app.get("/users", handler)`, PHP writes `$app->get('/users', …)`
 * and Rust writes `app.get("/users", handler)`. Six spellings, one
 * meaning.
 *
 * A scanner that only knows "there is a call, the receiver is `app`,
 * the method is `get`, the first argument is the path" works on all
 * six. A scanner that re-derives the method by splitting the callee
 * text on dots works on one — and silently loses `this.router.get`,
 * `server["get"]` and `app[M]` even on that one.
 *
 * So the contract separates the **structure** of the call from its
 * **spelling**:
 *
 * - `receiver` — the object the method is invoked on (`"app"`,
 *   `"this.router"`, `"api.router"`, `"getRouter()"`).
 * - `receiverKind` — *how* the receiver is reached. This is what lets
 *   a consumer tell `this.router.get(...)` (a class member) from
 *   `api.router.get(...)` (a property chain) without parsing text.
 * - `method` — the name of the invoked member, when it is written as
 *   a plain name.
 * - `resolvedMethod` — the method name when it was written as a
 *   computed expression and constant propagation could resolve it
 *   (`const M = "get"; app[M](...)` → `"get"`).
 * - `callee` — the **textual** callee, kept for error messages and
 *   for consumers that genuinely need the spelling. It is a report,
 *   not a parsing surface: `callee` is never the source of truth.
 *
 * ## Why the arguments are values and not expressions
 *
 * `IArgumentValue` models what a consumer can *read* out of an
 * argument without evaluating the program: a literal, a name, an
 * object shape, a list of values, or "something I cannot read". The
 * last one is explicit (`kind: "unknown"`) instead of a silent
 * omission, because a consumer that has to distinguish "no argument"
 * from "an argument I could not read" cannot do it if both look like
 * an empty list.
 *
 * (r00020 S2 — LanguageIR agnostic foundation)
 */

import type { ILocation } from "./location.interface.js";

/**
 * How the receiver of a call is reached.
 *
 * - `identifier` — `app.get`. The receiver is a plain name.
 * - `this` — `this.router.get`. The receiver is the current object.
 * - `member` — `api.router.get`. The receiver is a property chain.
 * - `factory` — `getRouter().get`. A call precedes the member: the
 *   method belongs to the *result* of the call.
 * - `computed` — `server["get"]`. The member is accessed with a
 *   computed expression instead of a name.
 * - `optional` — `router?.get`. Optional chaining.
 */
export type CallReceiverKind =
  | "identifier"
  | "this"
  | "member"
  | "factory"
  | "computed"
  | "optional";

/**
 * What an argument looks like when it is read statically.
 *
 * - `string` / `number` / `boolean` — a literal of that type.
 * - `null` / `undefined` — the two "no value" literals.
 * - `identifier` — a name (`handler`), not a value.
 * - `object` — a structure literal; its fields are in `shape`.
 * - `array` — a list literal; its items are in `items`.
 * - `callable` — a function value (a lambda, a function reference).
 * - `unknown` — anything else. The consumer must not guess.
 */
export type ArgumentKind =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "undefined"
  | "identifier"
  | "object"
  | "array"
  | "callable"
  | "unknown";

/**
 * An argument of a call, read statically.
 *
 * Which field applies depends on `kind`:
 *
 * - `string` / `number` / `boolean` → `value`.
 * - `null` / `undefined` → the kind is the whole answer.
 * - `identifier` → `identifierName` (the name it refers to).
 * - `object` → `shape` (the fields, in source order).
 * - `array` → `items` (the elements, in source order).
 * - `callable` / `unknown` → nothing else is guaranteed.
 */
export interface IArgumentValue {
  /** Discriminator: which of the fields below carries the meaning. */
  readonly kind: ArgumentKind;
  /** The literal value, for `string` / `number` / `boolean`. */
  readonly value?: string | number | boolean | null;
  /** The name referred to, for `kind: "identifier"`. */
  readonly identifierName?: string;
  /** The fields of an object literal, for `kind: "object"`. */
  readonly shape?: ReadonlyArray<{
    readonly key: string;
    readonly literal: IArgumentValue;
  }>;
  /** The elements of an array literal, for `kind: "array"`. */
  readonly items?: ReadonlyArray<IArgumentValue>;
}

/**
 * A call expression, in the shape every language can produce.
 */
export interface ICallExpression {
  /**
   * The callee **as it is written** (`"app.get"`, `"this.router.get"`,
   * `"server[\"get\"]"`). Kept for error messages and for consumers
   * that need the spelling; it is never the source of truth — use
   * `receiver`, `receiverKind` and `method` for that.
   */
  readonly callee: string;
  /**
   * The receiver without the method segment: `"app"`, `"this.router"`,
   * `"api.router"`, `"getRouter()"`. Absent when the call has no
   * receiver at all.
   */
  readonly receiver?: string;
  /** How the receiver is reached. */
  readonly receiverKind: CallReceiverKind;
  /**
   * The name of the invoked member, when it is written as a plain
   * name. Empty or absent when the member was computed
   * (`server["get"]`) — then `resolvedMethod` may carry it.
   */
  readonly method?: string;
  /**
   * The method name when constant propagation resolved a computed
   * member (`const M = "get"; app[M](...)` → `"get"`).
   */
  readonly resolvedMethod?: string;
  /** The arguments of the call, in source order. */
  readonly args: ReadonlyArray<IArgumentValue>;
  /** Where the call starts. */
  readonly location: ILocation;
}
