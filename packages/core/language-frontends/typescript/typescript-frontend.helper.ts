/**
 * `typescriptFrontend` — the TypeScript implementation of the
 * language-agnostic frontend contract.
 *
 * ## What this module is
 *
 * The contract (`packages/contracts/interfaces/language-ir/`) asks a
 * language four questions: which symbols does this file declare,
 * which calls does it make, which markers does it carry, and where in
 * the file is each of them. This module answers them for
 * JavaScript/TypeScript, in the vocabulary of that contract and
 * without mentioning the parser it uses.
 *
 * It is the **only** place in the repository allowed to know that
 * TypeScript is parsed by a JavaScript parser. Everything above it —
 * the scanners, the discovery pipeline, the exporters — works with
 * `ISymbol`, `ICallExpression` and `IDecorator`.
 *
 * ## Why it does not replace the TypeScript frontend
 *
 * The TypeScript frontend (`typescript.parser.ts`) produces a
 * `TSFile`: a richer, TypeScript-shaped view that the six
 * JavaScript scanners already consume (imports, assignments, classes,
 * method calls, decorators). Replacing it would mean rewriting six
 * scanners for no gain.
 *
 * So this module sits **beside** it and projects: the same parse, the
 * same normalized AST, read through the agnostic lens. Nothing that
 * consumes the TypeScript frontend changes; the agnostic view is
 * added, not substituted.
 *
 * ## One parse, two views
 *
 * `parseWithProgram` returns the normalized AST *and* the parse tree
 * it came from. The tree is handed to the LanguageIR builder, which
 * recognises the multi-style callees (`this.router.get`,
 * `server["get"]`, `app[M]`) that a plain `ident.method` collector
 * misses. One parse, two views — the file is never read twice.
 *
 * ## The name of the file
 *
 * The proposal for this slice named it `typescript-frontend.service.ts`.
 * The naming gate (`lint:naming`) only admits `.parser.ts` and
 * `.helper.ts` inside `packages/core/language-frontends/typescript/`,
 * and this slice does not touch that gate, so the file keeps the
 * suffix the gate accepts.
 *
 * (r00020 S2 — LanguageIR agnostic foundation)
 */

import type { IRouteCallExpression } from "../../../contracts/interfaces/core/language-ir.interface.js";
import type { TSLiteral } from "../../../contracts/interfaces/core/language/typescript-frontend-literal.interface.js";
import type { TSFile } from "../../../contracts/interfaces/core/language/typescript-frontend.interface.js";
import type {
  IArgumentValue,
  ICallExpression,
  IDecorator,
  ILanguageDocument,
  ILanguageFrontend,
  ISymbol,
} from "../../../contracts/interfaces/language-ir/language-ir.interface.js";

import { buildLanguageIRFromProgram } from "../../language-ir/build-language-ir.helper.js";
import { offsetToPosition } from "../../language-ir/scanner-bridge.helper.js";
import { parseWithProgram } from "./typescript.parser.js";

/** Identifier of the language this frontend reads. */
const LANGUAGE_ID = "typescript";

/**
 * Converts a TypeScript literal into the agnostic argument value.
 *
 * The mapping is total: every literal the TypeScript frontend knows
 * becomes an `IArgumentValue`, and the ones it does not understand
 * become `kind: "unknown"` instead of disappearing. A consumer that
 * has to tell "no argument" from "an argument I could not read"
 * cannot do it if the second one looks like the first.
 *
 * The one rename: a function value (`arrow` in the TypeScript
 * vocabulary) is a `callable` in the agnostic one, because "arrow
 * function" is a spelling, not a category.
 */
function toArgumentValue(literal: TSLiteral): IArgumentValue {
  switch (literal.kind) {
    case "arrow":
      return { kind: "callable" };
    case "object":
      return {
        kind: "object",
        shape: (literal.objectShape ?? []).map((field) => ({
          key: field.key,
          literal: toArgumentValue(field.literal),
        })),
      };
    case "array":
      return {
        kind: "array",
        items: (literal.arrayItems ?? []).map((item) => toArgumentValue(item)),
      };
    case "string":
    case "number":
    case "boolean":
    case "null":
    case "undefined":
      return {
        kind: literal.kind,
        ...(literal.value !== undefined ? { value: literal.value } : {}),
      };
    case "identifier":
      return {
        kind: "identifier",
        ...(literal.identifierName !== undefined
          ? { identifierName: literal.identifierName }
          : {}),
      };
    default:
      return { kind: "unknown" };
  }
}

/**
 * Projects the declarations of the normalized AST into agnostic
 * symbols.
 *
 * Classes come from the `classes` collection (which knows whether
 * they are exported) and their methods are attached to them through
 * `parent`. The top-level `symbols` collection is skipped for
 * classes to avoid reporting the same declaration twice.
 */
function toSymbols(tsFile: TSFile, filename: string): ISymbol[] {
  const out: ISymbol[] = [];
  for (const symbol of tsFile.symbols) {
    if (symbol.kind === "class") continue;
    out.push({
      name: symbol.name,
      kind: symbol.kind,
      exported: symbol.exported,
      location: { file: filename, line: symbol.line, column: 0 },
    });
  }
  for (const declaration of tsFile.classes) {
    out.push({
      name: declaration.name,
      kind: "class",
      exported: declaration.exported,
      location: { file: filename, line: declaration.line, column: 0 },
    });
    for (const method of declaration.methods) {
      out.push({
        name: method.name,
        kind: "method",
        exported: false,
        location: { file: filename, line: method.line, column: 0 },
        parent: declaration.name,
      });
    }
  }
  return out;
}

/**
 * Projects the markers of the normalized AST into agnostic
 * decorators.
 *
 * `TSDecorator` and `IAttribute` have the same shape; only the
 * vocabulary of the names differs, and that is data.
 */
function toDecorators(tsFile: TSFile, filename: string): IDecorator[] {
  return tsFile.decorators.map((decorator) => ({
    name: decorator.name,
    args: decorator.args.map((argument) => toArgumentValue(argument)),
    target: decorator.target,
    location: { file: filename, line: decorator.line, column: 0 },
  }));
}

/**
 * Projects the multi-style calls of the LanguageIR into agnostic call
 * expressions.
 *
 * The LanguageIR already classifies the receiver and resolves the
 * method of the six callee shapes it recognises; this projection
 * keeps that structure and only adds the position, which the IR
 * carries as a character range.
 */
function toCalls(
  calls: ReadonlyArray<IRouteCallExpression>,
  source: string,
  filename: string,
): ICallExpression[] {
  const out: ICallExpression[] = [];
  for (const call of calls) {
    const position = offsetToPosition(source, call.range.start);
    out.push({
      callee: call.callee,
      ...(call.receiver !== undefined ? { receiver: call.receiver } : {}),
      receiverKind: call.receiverKind,
      ...(call.method ? { method: call.method } : {}),
      ...(call.resolvedMethod !== undefined
        ? { resolvedMethod: call.resolvedMethod }
        : {}),
      args: call.args.map((argument) => toArgumentValue(argument)),
      location: {
        file: call.range.file || filename,
        line: position.line,
        column: position.column,
        start: call.range.start,
        end: call.range.end,
      },
    });
  }
  return out;
}

/**
 * Reads a TypeScript source file and answers the four questions of
 * the agnostic contract.
 *
 * The parse is the one the TypeScript frontend already performs; the
 * document it returns is the agnostic projection of that parse. A
 * consumer that needs the TypeScript-shaped view keeps using
 * `parse()`; a consumer that only speaks the agnostic vocabulary
 * uses this one.
 */
export const typescriptFrontend: ILanguageFrontend = {
  languageId: LANGUAGE_ID,

  parse(source: string, filename: string): ILanguageDocument {
    const { tsFile, program } = parseWithProgram(source, filename);
    const ir = buildLanguageIRFromProgram(program, filename);
    return {
      languageId: LANGUAGE_ID,
      filename,
      symbols: toSymbols(tsFile, filename),
      calls: toCalls(ir.calls, source, filename),
      decorators: toDecorators(tsFile, filename),
    };
  },

  extractSymbols(document: ILanguageDocument): ReadonlyArray<ISymbol> {
    return document.symbols;
  },

  extractCalls(document: ILanguageDocument): ReadonlyArray<ICallExpression> {
    return document.calls;
  },

  extractDecorators(document: ILanguageDocument): ReadonlyArray<IDecorator> {
    return document.decorators;
  },
};
