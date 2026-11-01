/**
 * `IDecorator` / `IAttribute` — a marker attached to a declaration.
 *
 * ## Two names, one shape
 *
 * JavaScript calls it a **decorator** (`@Get("/users")`), Python calls
 * it a **decorator** too (`@app.get("/users")`), Java calls it an
 * **annotation** (`@GetMapping("/users")`) and C# calls it an
 * **attribute** (`[HttpGet("users")]`). The mechanism is the same
 * everywhere: a name, some arguments, and the declaration it is
 * attached to.
 *
 * The contract therefore declares the shape once, as `IAttribute`,
 * and publishes `IDecorator` as an alias of it. A frontend that
 * reads Python fills the same slot as a frontend that reads Java; the
 * consumer does not branch on the language, it branches on the name
 * of the marker (`"Get"`, `"GetMapping"`, `"HttpGet"`), which is data
 * and not vocabulary.
 *
 * ## Why `target` is a name and not a reference
 *
 * `target` is the name of the decorated declaration (`"UsersController"`,
 * `"listUsers"`). Not an object, not an id: the whole point of the
 * agnostic contract is that a consumer can match a decorator against
 * the declaration it decorates **without resolving symbols**, which
 * is what a cross-file consumer would otherwise have to do before it
 * could read anything.
 *
 * (r00020 S2 — LanguageIR agnostic foundation)
 */

import type { IArgumentValue } from "./call.interface.js";
import type { ILocation } from "./location.interface.js";

/**
 * A marker attached to a declaration: a decorator, an annotation, an
 * attribute.
 */
export interface IAttribute {
  /**
   * The name of the marker, without the language's sigil: `"Get"`
   * for `@Get("/users")`, `"GetMapping"` for `@GetMapping("/users")`,
   * `"HttpGet"` for `[HttpGet("users")]`.
   */
  readonly name: string;
  /** The arguments of the marker, in source order. */
  readonly args: ReadonlyArray<IArgumentValue>;
  /** Name of the declaration the marker is attached to. */
  readonly target: string;
  /** Where the marker starts. */
  readonly location: ILocation;
}

/**
 * A decorator **is** an attribute — the same shape under the name the
 * JavaScript and Python ecosystems use for it.
 */
export type IDecorator = IAttribute;
