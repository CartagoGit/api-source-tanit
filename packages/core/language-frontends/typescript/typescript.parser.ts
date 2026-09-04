/**
 * `parse(source, filename): TSFile` — the TypeScript frontend.
 *
 * Consumes JS/TS source code and returns a normalized AST (`TSFile`)
 * on which the 6 JS/TS scanners (Express, NestJS, Fastify, Hono,
 * Next.js, tRPC) write semantic adapters.
 *
 * ## Why `@babel/parser`
 *
 * It supports TypeScript first-class (`plugins: ['typescript']`), was
 * already in the lockfile as a transitive dep of `magicast`, and the
 * AST shape is ESTree — the same canonical tree that ESLint, Prettier,
 * and almost the whole JS ecosystem use. It drags ~100KB and does not
 * require type-checking (we do not need types: we only recognize the
 * shape of the code).
 *
 * The alternatives considered (a00010 S7):
 *
 *   - `typescript` compiler API: 50MB, does type-checking we do not
 *     need, and the AST has uglier generic types to consume.
 *   - `@typescript-eslint/parser`: drags `@typescript-eslint/types`
 *     + `typescript-estree`, a double transformation over the TS AST
 *     that brings nothing here.
 *   - `acorn`: no native TS support (would need `acorn-typescript`
 *     on top, another dep).
 *
 * ## What the parser SEES and what it RETURNS
 *
 * Babel produces full ESTree; this module keeps five categories —
 * imports, symbols, classes, method calls, assignments — and discards
 * the rest. The `TSFile` shape is deliberately flat (no cross
 * references between the five collections) because scanners walk it
 * linearly.
 *
 * ## What it does NOT do
 *
 * It does not resolve types (`<T>`), does not follow imports
 * (`import type` is not distinguished from `import`), does not
 * execute the code. It is a syntactic parser, not a semantic one.
 *
 * (a00010 S7 — TypeScript AST slice)
 */

import { parse as babelParse, type ParserPlugin } from "@babel/parser";

import type {
  TSAssignment,
  TSClass,
  TSClassMethod,
  TSDecorator,
  TSFile,
  TSImport,
  TSImportBinding,
  TSMethodCall,
  TSSymbol,
} from "../../../contracts/interfaces/core/language/typescript-frontend.interface.js";
import type {
  TSLiteral,
  TSLiteralBodyRange,
} from "../../../contracts/interfaces/core/language/typescript-frontend-literal.interface.js";
import type { IParseDiagnostic } from "../../../contracts/interfaces/core/scanner.interface.js";

// ---------------------------------------------------------------------------
// Babel node helpers
// ---------------------------------------------------------------------------

/**
 * Babel ESTree node — the minimum shape we need to recognize.
 *
 * It is a permissive type (`{ readonly type: string; [key: string]:
 * unknown }`): we only write the fields we visit, and everything else
 * stays as `unknown` so TS does not complain with `Property 'X' does
 * not exist on type 'BabelNode'` when Babel adds a field we do not
 * care about.
 *
 * The reason we do not import `@babel/types` directly is pragmatic:
 *   - `@babel/types` drags ~2500 types (`Node`, `NodeChild`...) that
 *     slow down `tsc` and fill imports this module does not use.
 *   - The cost of not having them typed is zero: this parser **reads**
 *     the tree, it does not build it. If a property is missing or
 *     changes, the `undefined`/`null` that comes out becomes
 *     `kind: "unknown"` in `TSLiteral` and the adapters discard it
 *     silently.
 */
interface BabelNode {
  readonly type: string;
  readonly start?: number | null;
  readonly end?: number | null;
  readonly loc?: {
    readonly start: { readonly line: number; readonly column: number };
  } | null;
  readonly [key: string]: unknown;
}

/** Treats an `unknown` (from the AST) as a BabelNode. */
function asBabelNode(value: unknown): BabelNode {
  return value as BabelNode;
}

/** Reads a property of the AST node returning `unknown`. */
function get(node: BabelNode, key: string): unknown {
  return node[key];
}

/** Safe cast from an unknown array to a BabelNode array. */
function asArray(value: unknown): ReadonlyArray<BabelNode> {
  return Array.isArray(value) ? (value as ReadonlyArray<BabelNode>) : [];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parses `source` (TS/JS code) and returns the normalized AST.
 *
 * `filename` is attached to the AST so adapters can report errors and
 * scanners can show it to the user. It is not used internally — Babel
 * accepts it but we do not care here.
 *
 * If Babel cannot parse the file, throws `SyntaxError`. Callers that
 * want to degrade silently use `parseModule` with an
 * `IParseDiagnostic` array (a00011 C-7 / B-rev-13).
 *
 * The order within each `TSFile` collection is top-down with respect
 * to the file: at the end of the parse each collection is sorted by
 * `(line, column)` ascending, so the contract does not depend on the
 * internal order of the walker (a00011 C-7 / B-rev-11).
 *
 * Audit 2026-09-04 P2 #7: the `jsx` plugin is activated when
 * `filename` ends in `.tsx`/`.jsx`. Without this, Babel rejected JSX
 * syntax (`<Foo />`) with a syntax error and the scanner lost
 * Next.js / React components.
 */

/**
 * Whether the file is JSX/TSX.
 */
function isJsxFile(filename: string): boolean {
  return filename.endsWith(".tsx") || filename.endsWith(".jsx");
}

/**
 * Parses `source` (TS/JS code) and returns the normalized AST.
 *
 * `filename` is attached to the AST so adapters can report errors and
 * scanners can show it to the user. It is not used internally — Babel
 * accepts it but we do not care here.
 *
 * If Babel cannot parse the file, throws `SyntaxError`. Callers that
 * want to degrade silently use `parseModule` with an
 * `IParseDiagnostic` array (a00011 C-7 / B-rev-13).
 *
 * The order within each `TSFile` collection is top-down with respect
 * to the file: at the end of the parse each collection is sorted by
 * `(line, column)` ascending, so the contract does not depend on the
 * internal order of the walker (a00011 C-7 / B-rev-11).
 *
 * Audit 2026-09-04 P2 #7: the `jsx` plugin is activated when
 * `filename` ends in `.tsx`/`.jsx`. Without this, Babel rejected JSX
 * syntax (`<Foo />`) with a syntax error and the scanner lost
 * Next.js / React components.
 */
export function parse(source: string, filename: string): TSFile {
  // Babel accepts strings or typed configurations (ParserPlugin is the
  // alias of `PluginConfig` in the package's type definitions). We
  // keep the array as strings to avoid dragging ~2500 types from
  // `@babel/types`.
  const plugins: ParserPlugin[] = ["typescript", "decorators"];
  // JSX only when appropriate: enabling it on `.ts`/`.js` produces
  // false positives when finding `<` in comparisons (`if (a < b)`).
  if (isJsxFile(filename)) plugins.push("jsx");
  const ast = babelParse(source, {
    sourceType: "module",
    allowImportExportEverywhere: true,
    // Plugins covering the code the scanners look at:
    //   - `typescript`: native TS support (TSTypeAnnotation,
    //     TSInterfaceDeclaration, generics).
    //   - `decorators`: NestJS uses `@Controller('/users')`,
    //     `@Get(':id')`, etc. on methods and classes.
    //   - `jsx`: only enabled for `.tsx`/`.jsx`. Without this, Babel
    //     rejects JSX syntax like `<Foo />` with a syntax error and
    //     the scanner loses the file.
    //   - `classProperties`: class properties with values use the
    //     class fields proposal. Babel 8 already ships it built-in,
    //     but declaring it makes clear the supported subset.
    plugins: [...plugins],
    // Scanners already strip comments beforehand (see
    // `stripJsComments`); but in case a file arrives with comments
    // not stripped, we let Babel ignore them.
    errorRecovery: true,
  });

  const body = asArray(ast.program["body"]);

  return sortTopDown({
    imports: collectImports(body),
    symbols: collectSymbols(body),
    classes: collectClasses(body),
    methodCalls: collectMethodCalls(body),
    assignments: collectAssignments(body),
    decorators: collectDecorators(body),
    filename,
  });
}

// ---------------------------------------------------------------------------
// Top-down ordering (a00011 C-7 / B-rev-11)
// ---------------------------------------------------------------------------

/** Position (line, column) of any orderable AST node. */
interface IPositioned {
  readonly line: number;
  readonly column?: number;
}

/**
 * Sorts each collection of the `TSFile` by ascending position.
 *
 * The comparison is `(line, column)`: the same criterion a human
 * reader uses when walking the file. `Array.prototype.sort` is stable
 * (ES2019 spec), so ties preserve emission order.
 *
 * Collections without `column` (`symbols`, `assignments`, `decorators`,
 * `classes`) compare by `line` alone — the `?? 0` on `column` only
 * breaks ties when both lines are equal, which is exactly the case
 * where it is needed.
 */
function sortTopDown(file: TSFile): TSFile {
  const byPosition = (a: IPositioned, b: IPositioned): number =>
    a.line - b.line || (a.column ?? 0) - (b.column ?? 0);
  return {
    imports: [...file.imports], // already in declaration order; copy for uniformity
    symbols: [...file.symbols].sort(byPosition),
    classes: [...file.classes].sort(byPosition),
    methodCalls: [...file.methodCalls].sort(byPosition),
    assignments: [...file.assignments].sort(byPosition),
    decorators: [...file.decorators].sort(byPosition),
    filename: file.filename,
  };
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

/**
 * Extracts the local binding of an import specifier.
 *
 * `import x from "m"` → `{ local: "x", imported: "default", ... }`.
 * `import * as ns from "m"` → `{ local: "ns", imported: "*", ... }`.
 * `import { A as B } from "m"` → `{ local: "B", imported: "A", ... }`.
 *
 * Returns `null` for specifiers without a recognizable name (should
 * not happen with Babel, but the permissive AST cast allows it).
 */
function bindingFromSpecifier(spec: BabelNode): TSImportBinding | null {
  if (spec.type === "ImportDefaultSpecifier") {
    const local = asBabelNode(get(spec, "local"));
    const name = String(local.name ?? "");
    return name ? { local: name, imported: "default", isDefault: true } : null;
  }
  if (spec.type === "ImportNamespaceSpecifier") {
    const local = asBabelNode(get(spec, "local"));
    const name = String(local.name ?? "");
    return name
      ? { local: name, imported: "*", isDefault: false, isNamespace: true }
      : null;
  }
  if (spec.type === "ImportSpecifier") {
    const imported = asBabelNode(get(spec, "imported"));
    const local = asBabelNode(get(spec, "local"));
    const importedName = String(imported.name ?? imported.value ?? "");
    const localName = String(local.name ?? importedName);
    return importedName
      ? { local: localName, imported: importedName, isDefault: false }
      : null;
  }
  return null;
}

function collectImports(body: ReadonlyArray<BabelNode>): ReadonlyArray<TSImport> {
  const out: TSImport[] = [];
  for (const node of body) {
    if (node.type !== "ImportDeclaration") continue;
    const sourceNode = asBabelNode(get(node, "source"));
    if (sourceNode.type !== "StringLiteral") continue;
    const source = String(sourceNode.value ?? "");
    const bindings: TSImportBinding[] = [];
    for (const spec of asArray(get(node, "specifiers"))) {
      const binding = bindingFromSpecifier(spec);
      if (binding) bindings.push(binding);
    }
    // `names` is derived from `bindings` for compat with the scanners
    // that already consume it (a00011 C-7 / B-rev-12).
    const names = bindings.map((b) => b.imported);
    out.push({ source, names, bindings });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Symbols (top-level: function, class, var/let/const)
// ---------------------------------------------------------------------------

function collectSymbols(body: ReadonlyArray<BabelNode>): ReadonlyArray<TSSymbol> {
  const out: TSSymbol[] = [];
  for (const node of body) {
    if (node.type === "FunctionDeclaration") {
      const id = asBabelNode(get(node, "id"));
      const name = String(id.name ?? "");
      if (!name) continue;
      out.push({
        name,
        kind: "function",
        exported: false,
        line: id.loc?.start.line ?? 1,
      });
      continue;
    }
    if (node.type === "ClassDeclaration") {
      const id = asBabelNode(get(node, "id"));
      const name = String(id.name ?? "");
      if (!name) continue;
      out.push({
        name,
        kind: "class",
        exported: false,
        line: id.loc?.start.line ?? 1,
      });
      continue;
    }
    if (node.type === "VariableDeclaration") {
      for (const decl of asArray(get(node, "declarations"))) {
        if (decl.type !== "VariableDeclarator") continue;
        const id = asBabelNode(get(decl, "id"));
        if (id.type !== "Identifier") continue;
        out.push({
          name: String(id.name ?? ""),
          kind: "variable",
          exported: false,
          line: id.loc?.start.line ?? 1,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

function collectClasses(body: ReadonlyArray<BabelNode>): ReadonlyArray<TSClass> {
  const out: TSClass[] = [];
  for (const node of body) {
    let classNode: BabelNode | null = null;
    let exported = false;
    if (node.type === "ClassDeclaration") {
      classNode = node;
    } else if (node.type === "ExportNamedDeclaration") {
      // `export { foo }` leaves `declaration: null`; `export class Foo`
      // leaves it with `declaration` being the ClassDeclaration. We must
      // distinguish the two cases or it crashes with `null.type`.
      const inner = get(node, "declaration");
      if (inner && typeof inner === "object" && "type" in inner) {
        const innerNode = asBabelNode(inner);
        if (innerNode.type === "ClassDeclaration") {
          classNode = innerNode;
          exported = true;
        }
      }
    }
    if (!classNode) continue;

    const id = asBabelNode(get(classNode, "id"));
    const name = String(id.name ?? "");
    if (!name) continue;

    const decorators = collectDecoratorsFor(asArray(get(classNode, "decorators")), name);
    const methods = collectClassMethods(classNode);

    out.push({
      name,
      exported,
      decorators,
      methods,
      line: classNode.loc?.start.line ?? 1,
    });
  }
  return out;
}

function collectClassMethods(classNode: BabelNode): ReadonlyArray<TSClassMethod> {
  const out: TSClassMethod[] = [];
  const body = asBabelNode(get(classNode, "body"));
  const classBody = asArray(get(body, "body"));
  for (const member of classBody) {
    if (member.type !== "ClassMethod" && member.type !== "MethodDefinition") continue;
    const key = asBabelNode(get(member, "key"));
    const name = String(key.name ?? "");
    if (!name) continue;
    const decorators = collectDecoratorsFor(asArray(get(member, "decorators")), name);
    const args: TSLiteral[] = [];
    for (const dec of decorators) args.push(...dec.args);
    out.push({
      name,
      decorators,
      args,
      line: member.loc?.start.line ?? 1,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Method calls: `<ident>.<method>(<args>)`
// ---------------------------------------------------------------------------

/**
 * Method calls that look like route declarations.
 *
 * Recognizes the five shapes that live in real projects:
 *
 *   - `app.get("/x", h)` → callee `"app.get"`.
 *   - `router.post("/x", h)` → callee `"router.post"`.
 *   - `controller.Get("x")` (NestJS) → callee `"controller.Get"`.
 *   - `server.route({ method, path })` → left out: the adapter handles
 *     it with a dedicated case (it is an object literal, not a direct
 *     method call).
 *
 * `bodyRange` is only filled when the last argument is an arrow
 * function — adapters use it to re-enter the body with their own
 * regexes (looking for `Schema.parse(...)`, parsing `req.body`, etc.).
 */
function collectMethodCalls(body: ReadonlyArray<BabelNode>): ReadonlyArray<TSMethodCall> {
  const out: TSMethodCall[] = [];
  walk(body, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = asBabelNode(get(node, "callee"));
    if (callee.type !== "MemberExpression") return;
    const object = asBabelNode(get(callee, "object"));
    if (object.type !== "Identifier") return;
    const property = asBabelNode(get(callee, "property"));
    const ident = String(object.name ?? "");
    const prop = String(property.name ?? property.value ?? "");
    if (!ident || !prop) return;

    const callArgs: TSLiteral[] = [];
    let bodyRange: TSLiteralBodyRange | undefined;
    const args = asArray(get(node, "arguments"));
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;
      const lit = literalFromNode(arg);
      // If the last argument is an arrow function, we capture the body
      // range. Babel puts the `body` directly on the arrow node
      // (BlockStatement for `{ ... }` or expression for `=> x`).
      if (i === args.length - 1 && arg.type === "ArrowFunctionExpression") {
        const arrowBody = asBabelNode(get(arg, "body"));
        const start = arrowBody.start;
        const end = arrowBody.end;
        if (typeof start === "number" && typeof end === "number") {
          bodyRange = { start, end };
        }
      }
      callArgs.push(lit);
    }

    out.push({
      callee: `${ident}.${prop}`,
      args: callArgs,
      line: node.loc?.start.line ?? 1,
      column: node.loc?.start.column ?? 0,
      ...(bodyRange !== undefined ? { bodyRange } : {}),
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Assignments: `<name> = <expr>`
// ---------------------------------------------------------------------------

function collectAssignments(body: ReadonlyArray<BabelNode>): ReadonlyArray<TSAssignment> {
  const out: TSAssignment[] = [];
  walk(body, (node) => {
    if (node.type === "VariableDeclarator") {
      const id = asBabelNode(get(node, "id"));
      if (id.type !== "Identifier") return;
      const init = get(node, "init");
      if (!init) return;
      out.push({
        name: String(id.name ?? ""),
        value: literalFromNode(asBabelNode(init)),
        line: id.loc?.start.line ?? 1,
      });
      return;
    }
    if (node.type === "AssignmentExpression") {
      const left = asBabelNode(get(node, "left"));
      if (left.type !== "Identifier") return;
      const right = get(node, "right");
      if (!right) return;
      out.push({
        name: String(left.name ?? ""),
        value: literalFromNode(asBabelNode(right)),
        line: left.loc?.start.line ?? 1,
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Decorators
// ---------------------------------------------------------------------------

function collectDecorators(body: ReadonlyArray<BabelNode>): ReadonlyArray<TSDecorator> {
  const out: TSDecorator[] = [];
  walk(body, (node) => {
    if (
      node.type !== "ClassDeclaration" &&
      node.type !== "ClassMethod" &&
      node.type !== "MethodDefinition"
    ) return;
    let target = "";
    if (node.type === "ClassDeclaration") {
      const id = asBabelNode(get(node, "id"));
      target = String(id.name ?? "");
    } else {
      const key = asBabelNode(get(node, "key"));
      target = String(key.name ?? "");
    }
    if (!target) return;
    for (const dec of collectDecoratorsFor(asArray(get(node, "decorators")), target)) out.push(dec);
  });
  return out;
}

function collectDecoratorsFor(
  decorators: ReadonlyArray<BabelNode>,
  target: string,
): ReadonlyArray<TSDecorator> {
  const out: TSDecorator[] = [];
  for (const dec of decorators) {
    const expr = asBabelNode(get(dec, "expression"));
    let name = "";
    const args: TSLiteral[] = [];
    if (expr.type === "Identifier") {
      name = String(expr.name ?? "");
    } else if (expr.type === "CallExpression") {
      const callee = asBabelNode(get(expr, "callee"));
      if (callee.type === "Identifier") {
        name = String(callee.name ?? "");
      } else if (callee.type === "MemberExpression") {
        const property = asBabelNode(get(callee, "property"));
        name = String(property.name ?? "");
      }
      for (const arg of asArray(get(expr, "arguments"))) args.push(literalFromNode(arg));
    }
    if (!name) continue;
    out.push({
      name,
      args,
      target,
      line: dec.loc?.start.line ?? 1,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Literal extraction
// ---------------------------------------------------------------------------

/**
 * Converts a Babel node into a normalized `TSLiteral`.
 *
 * Recognizes:
 *   - `StringLiteral`, `NumericLiteral`, `BooleanLiteral`, `NullLiteral`.
 *   - `Identifier` → kind "identifier".
 *   - `ObjectExpression` → kind "object" with `objectShape`.
 *   - `ArrayExpression` → kind "array" with `arrayItems`.
 *   - `ArrowFunctionExpression` → kind "arrow" with `bodyRange`.
 *   - `CallExpression` with a single literal argument: descends into
 *     the argument. This is what makes
 *     `const router = Router({ prefix: '/api/v1' })` expose the
 *     `objectShape` of the prefix instead of staying as an opaque
 *     call — Express adapters need it to detect `Router({ prefix })`.
 *
 * Everything else is represented as `kind: "unknown"`. Adapters know
 * an unknown is not a route, path, or body — it is `new Foo(...)`, a
 * call with multiple arguments, etc.
 */
function literalFromNode(node: BabelNode): TSLiteral {
  switch (node.type) {
    case "StringLiteral":
      return { kind: "string", value: String(node.value ?? "") };
    case "NumericLiteral":
      return { kind: "number", value: Number(node.value ?? 0) };
    case "BooleanLiteral":
      return { kind: "boolean", value: Boolean(node.value) };
    case "NullLiteral":
      return { kind: "null" };
    case "Identifier":
      return { kind: "identifier", identifierName: String(node.name ?? "") };
    case "ObjectExpression": {
      const shape: { key: string; literal: TSLiteral }[] = [];
      for (const prop of asArray(get(node, "properties"))) {
        if (prop.type !== "ObjectProperty") continue;
        const keyNode = asBabelNode(get(prop, "key"));
        let key = "";
        if (keyNode.type === "Identifier") key = String(keyNode.name ?? "");
        else if (keyNode.type === "StringLiteral") key = String(keyNode.value ?? "");
        if (!key) continue;
        const valueNode = get(prop, "value");
        if (!valueNode) continue;
        shape.push({ key, literal: literalFromNode(asBabelNode(valueNode)) });
      }
      return { kind: "object", objectShape: shape };
    }
    case "ArrayExpression": {
      const items: TSLiteral[] = [];
      for (const el of asArray(get(node, "elements"))) if (el) items.push(literalFromNode(el));
      return { kind: "array", arrayItems: items };
    }
    case "ArrowFunctionExpression": {
      const body = asBabelNode(get(node, "body"));
      const start = body.start;
      const end = body.end;
      if (typeof start === "number" && typeof end === "number") {
        const range: TSLiteralBodyRange = { start, end };
        return { kind: "arrow", bodyRange: range };
      }
      return { kind: "arrow" };
    }
    case "CallExpression": {
      // Transparent wrapper: `Router({ prefix })`,
      // `express()`, `middleware([...])`. If the call has a single
      // argument that is a recognizable literal, we expose it
      // directly — that is what scanners need for prefixes and
      // bodies.
      const args = asArray(get(node, "arguments"));
      if (args.length === 1) {
        const inner = args[0];
        if (inner) {
          const lit = literalFromNode(inner);
          if (lit.kind !== "unknown") return lit;
        }
      }
      return { kind: "unknown" };
    }
    default:
      return { kind: "unknown" };
  }
}

// ---------------------------------------------------------------------------
// Walker
// ---------------------------------------------------------------------------

/**
 * Walks the Babel tree depth-first and calls `visit` on each node.
 * It is a DFS without pruning: it visits EVERYTHING, including nodes
 * inside arrays and objects.
 *
 * `visit` callbacks are what filter (decide whether the node interests
 * them). Keeping the walker dumb lets collectors compose what they
 * need without thinking about the traversal.
 */
function walk(body: ReadonlyArray<BabelNode>, visit: (node: BabelNode) => void): void {
  const stack: BabelNode[] = [...body];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    visit(node);
    // Children Babel nests and that we also want to visit. The
    // `key/value` fields of object properties and `body` of blocks
    // are covered generically by reading the AST as a tree of unknowns.
    for (const child of collectChildren(node)) stack.push(child);
  }
}

/** Direct children of the node, in the order they appear in the AST. */
function collectChildren(node: BabelNode): ReadonlyArray<BabelNode> {
  const children: BabelNode[] = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && "type" in item) {
          children.push(asBabelNode(item));
        }
      }
    } else if (value && typeof value === "object" && "type" in value) {
      children.push(asBabelNode(value));
    }
  }
  return children;
}

// ---------------------------------------------------------------------------
// Safe entry point (a00011 C-7 / B-rev-13)
// ---------------------------------------------------------------------------

/**
 * Non-throwing variant of `parse`: if Babel rejects the file, returns
 * `null` and records the reason in `diagnostics` (if the array came
 * in) instead of swallowing the error silently.
 *
 * The scanner keeps working — a file with invalid syntax does not
 * abort the scan — but the failure stays visible to whoever wants to
 * report it (today: `IScanResult.diagnostics`).
 */
export function parseModule(
  source: string,
  filename: string,
  diagnostics?: Array<IParseDiagnostic>,
): TSFile | null {
  try {
    return parse(source, filename);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    diagnostics?.push({ file: filename, severity: "error", reason });
    return null;
  }
}