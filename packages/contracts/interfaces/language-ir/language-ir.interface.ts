/**
 * Barrel of the language-agnostic frontend contract.
 *
 * Every type here describes source code without naming any language:
 * a location, a symbol, a call, a marker and the frontend that
 * produces them. The TypeScript implementation lives in
 * `packages/core/language-frontends/typescript/`; the Python, PHP, Go
 * and Java ones are written against this same contract.
 *
 * (r00020 S2 — LanguageIR agnostic foundation)
 */

export type {
  ILanguageFrontend,
  ILanguageDocument,
} from "./frontend.interface.js";
export type { ISymbol, SymbolKind } from "./symbol.interface.js";
export type {
  ICallExpression,
  CallReceiverKind,
  IArgumentValue,
  ArgumentKind,
} from "./call.interface.js";
export type { IDecorator, IAttribute } from "./decorator.interface.js";
export type { ILocation } from "./location.interface.js";
