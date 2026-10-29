/**
 * `ILanguageFrontend` — the contract every language plugs into.
 *
 * ## What it is for
 *
 * Tanit reads source code. Today it reads JavaScript and TypeScript,
 * with a parser that understands decorators, JSX and the module
 * system of npm. Python, PHP, Go and Java have their own scanners
 * that do their own parsing, and every one of them had to be written
 * from scratch because there was no shared place where "the symbols
 * of a file", "the calls of a file" and "the decorators of a file"
 * were described.
 *
 * This interface is that place. A frontend reads a file and answers
 * four questions — what symbols does it declare, what calls does it
 * make, what decorators does it carry — in a vocabulary that does not
 * mention any particular language. A consumer that only needs the
 * path of an HTTP route can then work on a Python project without
 * knowing that Python was involved.
 *
 * ## The four questions
 *
 * - `parse` — reads the source and returns a document. It is the only
 *   method allowed to know about the concrete syntax.
 * - `extractSymbols` — the declarations of the document.
 * - `extractCalls` — the calls of the document.
 * - `extractDecorators` — the markers of the document.
 *
 * The three `extract*` methods take the **document**, not the source
 * text. That is deliberate: a consumer that needs both the symbols
 * and the calls of a file parses once. Re-parsing per question is the
 * mistake that made the TypeScript pipeline parse every file four
 * times before the LanguageIR arrived.
 *
 * ## The document
 *
 * `ILanguageDocument` is what `parse` returns. It carries the three
 * collections and nothing else — no AST, no parser object, no
 * language-specific state. A frontend that needs to keep its parse
 * tree around (the TypeScript one does, to build the richer
 * multi-style call catalogue) keeps it **outside** the document and
 * returns the projections from it.
 *
 * ## What the contract does NOT promise
 *
 * It does not promise that every call of every language is
 * collected, and it does not promise a fixed set of symbols. It
 * promises that whatever a frontend does return is described in the
 * agnostic vocabulary, and that a consumer never has to know which
 * language produced it.
 *
 * (r00020 S2 — LanguageIR agnostic foundation)
 */

import type { ICallExpression } from "./call.interface.js";
import type { IDecorator } from "./decorator.interface.js";
import type { ISymbol } from "./symbol.interface.js";

/**
 * The result of reading one file with one frontend.
 *
 * It carries the collections, the file it came from and the language
 * that produced it. It does **not** carry a parse tree: a document is
 * data a consumer can hold, print and compare, never an object with
 * a parser behind it.
 */
export interface ILanguageDocument {
  /** Identifier of the language that produced the document. */
  readonly languageId: string;
  /** Path of the file the document was read from. */
  readonly filename: string;
  /** The declarations found in the file. */
  readonly symbols: ReadonlyArray<ISymbol>;
  /** The calls found in the file. */
  readonly calls: ReadonlyArray<ICallExpression>;
  /** The markers (decorators, annotations, attributes) found in the file. */
  readonly decorators: ReadonlyArray<IDecorator>;
}

/**
 * A frontend for one language.
 *
 * A frontend is the only place in Tanit that is allowed to know how a
 * language is written. Everything above it — scanners, the discovery
 * pipeline, the exporters — works with the agnostic shapes.
 */
export interface ILanguageFrontend {
  /**
   * Identifier of the language this frontend reads. Stable, lowercase
   * and short: `"typescript"`, `"javascript"`, `"python"`, `"php"`,
   * `"go"`, `"java"`.
   */
  readonly languageId: string;

  /**
   * Reads `source` and returns the document.
   *
   * `filename` is the path the source came from; it is attached to
   * every location so a consumer can report it without being told
   * again.
   *
   * A frontend that cannot read the file throws; one that can read
   * it partially returns what it managed to read. Both are allowed —
   * what is not allowed is returning something that is not the
   * agnostic document.
   */
  parse(source: string, filename: string): ILanguageDocument;

  /** The declarations of a document. */
  extractSymbols(document: ILanguageDocument): ReadonlyArray<ISymbol>;

  /** The calls of a document. */
  extractCalls(document: ILanguageDocument): ReadonlyArray<ICallExpression>;

  /** The markers of a document. */
  extractDecorators(document: ILanguageDocument): ReadonlyArray<IDecorator>;
}
