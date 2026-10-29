/**
 * `ISymbol` — a name a language declares.
 *
 * A function, a class, a method, a variable, a constant, a type
 * alias, a property. The list is the intersection of what the
 * languages Tanit reads have in common, not the union of what one of
 * them has: `ISymbol` describes the *declaration*, not the language
 * that wrote it.
 *
 * ## Why `kind` is a closed set
 *
 * A scanner that only cares about HTTP handlers asks "is this a
 * method?". A scanner that resolves cross-file mounts asks "is this a
 * class?". Both questions have to have the same answer in Python, in
 * Go and in TypeScript — otherwise every new language invents its own
 * vocabulary and the consumers end up with a `switch` per language.
 * The set is closed on purpose: adding a kind is a contract change
 * that every consumer has to be ready for.
 *
 * `method` is the kind that needed the most care. In a language with
 * first-class functions (Python, Go) a "method" is a function bound
 * to a receiver; in a language without them (Rust, Go's plain
 * functions) the equivalent is a `function`. The distinction that
 * matters to a consumer is **"is it attached to something?"**, and
 * `parent` answers exactly that: a method has a `parent` (the class
 * it belongs to), a free function does not.
 *
 * (r00020 S2 — LanguageIR agnostic foundation)
 */

import type { ILocation } from "./location.interface.js";

/**
 * The kind of declaration a symbol is.
 *
 * - `function` — a free function, or a method without a `parent`.
 * - `class` — a class / struct / interface declaration.
 * - `method` — a member function, attached to a `parent`.
 * - `variable` — a mutable binding.
 * - `constant` — an immutable binding (`const`, `final`, `val`).
 * - `property` — a field of a class or struct.
 * - `type` — a type alias, an interface declaration used as a type.
 * - `module` — a namespace / package declaration.
 */
export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "variable"
  | "constant"
  | "property"
  | "type"
  | "module";

export interface ISymbol {
  /** The declared name, as written in the source. */
  readonly name: string;
  /** What kind of declaration this is. */
  readonly kind: SymbolKind;
  /** Whether the declaration is visible outside its module. */
  readonly exported: boolean;
  /** Where the declaration starts. */
  readonly location: ILocation;
  /**
   * Name of the symbol that contains this one — the class a method
   * belongs to, the struct a field belongs to. Absent for symbols
   * declared at the top level of a file.
   */
  readonly parent?: string;
}
