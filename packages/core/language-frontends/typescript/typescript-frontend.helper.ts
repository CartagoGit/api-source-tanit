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
 * ## Where a declaration is
 *
 * The normalized AST carries the **line** of every declaration but not
 * its column: the legacy contract was written for scanners, which
 * report "line 42 of `routes.ts`" and never needed the column. The
 * agnostic contract asks for both, so the columns are read from the
 * same parse tree — still one parse.
 *
 * The position of a declaration is its **anchor**: the name it
 * introduces. The `A` of `class A` is at column 6; the `getUser` of
 * `  getUser() {}` is at column 2. Not the node that carries it: a
 * decorated declaration *starts* at its decorator, and a consumer that
 * positions by column would be sent to the `@` instead of to the name
 * it is looking for.
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
  ILocation,
  ISymbol,
} from "../../../contracts/interfaces/language-ir/language-ir.interface.js";

import { buildLanguageIRFromProgram } from "../../language-ir/build-language-ir.helper.js";
import { offsetToPosition } from "../../language-ir/scanner-bridge.helper.js";
import { parseWithProgram } from "./typescript.parser.js";

/** Identifier of the language this frontend reads. */
const LANGUAGE_ID = "typescript";

// ---------------------------------------------------------------------------
// Anchors — the position of every declaration
// ---------------------------------------------------------------------------

/**
 * The position of a declaration: 1-based line, 0-based column.
 *
 * It is the position of the declaration's **anchor** — the name it
 * introduces — and not the position of the node that carries it.
 */
interface IAnchor {
  readonly line: number;
  readonly column: number;
}

/**
 * The anchors of the declarations of a file, keyed by what the
 * projection knows about them.
 *
 * The key is `symbol:<kind>:<name>` for a top-level declaration,
 * `class:<name>` for a class, `method:<class>:<name>` for a method and
 * `decorator:<target>:<name>` for a marker. Keying by name and not by
 * position keeps the lookup independent of the order in which the
 * parser happened to walk the tree.
 */
type IAnchors = ReadonlyMap<string, IAnchor>;

/**
 * The shape of the parse-tree nodes this module reads.
 *
 * `parseWithProgram` returns the `Program` as `unknown` on purpose:
 * the frontend does not expose `@babel/types` in its public surface
 * (that would be ~2500 types of dependency). The projection reads four
 * things from the tree — the type, the name, the children and the
 * position — and this is exactly those four.
 */
interface IParsedNode {
  readonly type?: string;
  readonly name?: string;
  readonly id?: IParsedNode;
  readonly key?: IParsedNode;
  readonly expression?: IParsedNode;
  readonly callee?: IParsedNode;
  readonly property?: IParsedNode;
  readonly declaration?: IParsedNode;
  readonly decorators?: ReadonlyArray<IParsedNode>;
  readonly loc?: {
    readonly start?: { readonly line: number; readonly column: number };
  } | null;
  readonly [key: string]: unknown;
}

/** A parse-tree node, when there is one. */
function nodoDe(value: unknown): IParsedNode | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as IParsedNode;
}

/** A list of parse-tree nodes, empty when the field is not a list. */
function nodosDe(value: unknown): ReadonlyArray<IParsedNode> {
  return Array.isArray(value) ? (value as ReadonlyArray<IParsedNode>) : [];
}

/** The name a node introduces, or the empty string. */
function nombreDe(nodo: IParsedNode | undefined): string {
  return nodo?.name ?? "";
}

/** The position of a node, when the parser reported one. */
function posicionDe(nodo: IParsedNode | undefined): IAnchor | undefined {
  const inicio = nodo?.loc?.start;
  if (!inicio) return undefined;
  return { line: inicio.line, column: inicio.column };
}

/** Records an anchor under a key, keeping the first one that was seen. */
function anota(
  anchors: Map<string, IAnchor>,
  key: string,
  anchor: IAnchor | undefined,
): void {
  if (!anchor) return;
  if (anchors.has(key)) return;
  anchors.set(key, anchor);
}

/** The direct children of a node, in the order they appear in the tree. */
function hijosDe(nodo: IParsedNode): ReadonlyArray<IParsedNode> {
  const hijos: IParsedNode[] = [];
  for (const valor of Object.values(nodo)) {
    if (Array.isArray(valor)) {
      for (const item of valor) {
        const hijo = nodoDe(item);
        if (hijo?.type) hijos.push(hijo);
      }
      continue;
    }
    const hijo = nodoDe(valor);
    if (hijo?.type) hijos.push(hijo);
  }
  return hijos;
}

/** The node that carries the name of a marker (`@Get` → the `Get`). */
function nodoDelNombre(decorator: IParsedNode): IParsedNode | undefined {
  const expression = decorator.expression;
  if (!expression) return undefined;
  if (expression.type === "Identifier") return expression;
  if (expression.type !== "CallExpression") return undefined;
  const callee = expression.callee;
  if (!callee) return undefined;
  if (callee.type === "Identifier") return callee;
  if (callee.type !== "MemberExpression") return undefined;
  return callee.property;
}

/** The anchor of a class and of each of its methods. */
function anotaClase(
  anchors: Map<string, IAnchor>,
  clase: IParsedNode,
): void {
  const nombre = nombreDe(clase.id);
  anota(anchors, `class:${nombre}`, posicionDe(clase.id));
  const cuerpo = nodosDe(nodoDe(clase["body"])?.["body"]);
  for (const miembro of cuerpo) {
    if (miembro.type !== "ClassMethod" && miembro.type !== "MethodDefinition") {
      continue;
    }
    const nombreMetodo = nombreDe(miembro.key);
    if (!nombreMetodo) continue;
    anota(
      anchors,
      `method:${nombre}:${nombreMetodo}`,
      posicionDe(miembro.key),
    );
  }
}

/**
 * The anchors of the markers of the file.
 *
 * The normalized AST collects the markers walking the **whole** tree —
 * a class nested in another one carries its own — so this walk does
 * the same.
 */
function anotaDecoradores(
  anchors: Map<string, IAnchor>,
  cuerpo: ReadonlyArray<IParsedNode>,
): void {
  for (const nodo of cuerpo) {
    const esClase = nodo.type === "ClassDeclaration";
    if (
      esClase ||
      nodo.type === "ClassMethod" ||
      nodo.type === "MethodDefinition"
    ) {
      const target = esClase ? nombreDe(nodo.id) : nombreDe(nodo.key);
      for (const decorator of nodo.decorators ?? []) {
        const delNombre = nodoDelNombre(decorator);
        if (!delNombre) continue;
        anota(
          anchors,
          `decorator:${target}:${nombreDe(delNombre)}`,
          posicionDe(delNombre),
        );
      }
    }
    anotaDecoradores(anchors, hijosDe(nodo));
  }
}

/**
 * The anchor of every declaration of the file.
 *
 * It walks the same parse tree the normalized AST was built from, and
 * it recognises the same declarations — the ones the parser reports:
 * a top-level function, a class (exported or not) and the variables
 * of a top-level declaration. A declaration the parser does not
 * report has no anchor, because there is nothing to project.
 */
function anchorsDe(program: unknown): Map<string, IAnchor> {
  const anchors = new Map<string, IAnchor>();
  const cuerpo = nodosDe(nodoDe(program)?.["body"]);

  for (const nodo of cuerpo) {
    if (nodo.type === "FunctionDeclaration") {
      anota(
        anchors,
        `symbol:function:${nombreDe(nodo.id)}`,
        posicionDe(nodo.id),
      );
      continue;
    }
    if (nodo.type === "ClassDeclaration") {
      anotaClase(anchors, nodo);
      continue;
    }
    if (nodo.type === "ExportNamedDeclaration") {
      const declaracion = nodoDe(nodo.declaration);
      if (declaracion?.type === "ClassDeclaration") {
        anotaClase(anchors, declaracion);
      }
      continue;
    }
    if (nodo.type === "VariableDeclaration") {
      for (const declarator of nodosDe(nodo["declarations"])) {
        if (declarator.type !== "VariableDeclarator") continue;
        const id = declarator.id;
        if (id?.type !== "Identifier") continue;
        anota(
          anchors,
          `symbol:variable:${nombreDe(id)}`,
          posicionDe(id),
        );
      }
    }
  }

  anotaDecoradores(anchors, cuerpo);
  return anchors;
}

/**
 * The column of a declaration when the parse tree did not offer an
 * anchor for it.
 *
 * It looks for the name in the line the declaration was reported on
 * and, when it is not there — a decorated declaration is reported on
 * the line of its decorator — it falls back to the first character of
 * code in that line. Both are real positions in the file: the
 * fallback gives up on being precise, never on being true.
 */
function columnaDeRespaldo(source: string, line: number, name: string): number {
  const texto = source.split("\n")[line - 1] ?? "";
  const indice = texto.indexOf(name);
  if (indice >= 0) return indice;
  const primero = texto.search(/\S/);
  return primero >= 0 ? primero : 0;
}

/**
 * The location of a declaration.
 *
 * The anchor — the name the declaration introduces — gives both the
 * line and the column. When the parse tree did not offer one, the
 * line the parser reported is kept and the column falls back to a
 * real position in that line.
 */
function locationDe(
  anchors: IAnchors,
  key: string,
  source: string,
  line: number,
  name: string,
  filename: string,
): ILocation {
  const anchor = anchors.get(key);
  if (anchor) {
    return { file: filename, line: anchor.line, column: anchor.column };
  }
  return {
    file: filename,
    line,
    column: columnaDeRespaldo(source, line, name),
  };
}

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
 *
 * The position of every declaration comes from its **anchor** — the
 * name it introduces — and the visibility of a method comes from the
 * class that holds it: the frontend does not model the visibility of
 * the members, and a public method of an exported class *is* visible
 * outside the module.
 */
function toSymbols(
  tsFile: TSFile,
  filename: string,
  anchors: IAnchors,
  source: string,
): ISymbol[] {
  const out: ISymbol[] = [];
  for (const symbol of tsFile.symbols) {
    if (symbol.kind === "class") continue;
    out.push({
      name: symbol.name,
      kind: symbol.kind,
      exported: symbol.exported,
      location: locationDe(
        anchors,
        `symbol:${symbol.kind}:${symbol.name}`,
        source,
        symbol.line,
        symbol.name,
        filename,
      ),
    });
  }
  for (const declaration of tsFile.classes) {
    out.push({
      name: declaration.name,
      kind: "class",
      exported: declaration.exported,
      location: locationDe(
        anchors,
        `class:${declaration.name}`,
        source,
        declaration.line,
        declaration.name,
        filename,
      ),
    });
    for (const method of declaration.methods) {
      out.push({
        name: method.name,
        kind: "method",
        exported: declaration.exported,
        location: locationDe(
          anchors,
          `method:${declaration.name}:${method.name}`,
          source,
          method.line,
          method.name,
          filename,
        ),
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
function toDecorators(
  tsFile: TSFile,
  filename: string,
  anchors: IAnchors,
  source: string,
): IDecorator[] {
  return tsFile.decorators.map((decorator) => ({
    name: decorator.name,
    args: decorator.args.map((argument) => toArgumentValue(argument)),
    target: decorator.target,
    location: locationDe(
      anchors,
      `decorator:${decorator.target}:${decorator.name}`,
      source,
      decorator.line,
      decorator.name,
      filename,
    ),
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
    const anchors = anchorsDe(program);
    return {
      languageId: LANGUAGE_ID,
      filename,
      symbols: toSymbols(tsFile, filename, anchors, source),
      calls: toCalls(ir.calls, source, filename),
      decorators: toDecorators(tsFile, filename, anchors, source),
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
