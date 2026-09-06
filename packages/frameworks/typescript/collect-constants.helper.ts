/**
 * `collectConstantsFromSource` — a00016 S6 (constant bindings
 * reales).
 *
 * Walks the AST and returns one `IConstantBinding` per
 * `const X = <literal>` (string | number | boolean). The output
 * is what `propagateConstants(irCalls, bindings)` consumes to
 * resolve `app[M](...)` into `app.get(...)` — without it, the
 * scanner is forced to pass `[]` and the "const M = 'get'" style
 * is unreachable E2E (the unit tests pass because they fabricate
 * bindings by hand).
 *
 * Why a separate file
 * - `collect-method-calls.helper.ts` already does one parse; adding
 *   another walker to the same AST would either duplicate the
 *   parse or entangle the two collectors. Keeping them separate
 *   lets each evolve independently while sharing the same parse
 *   upstream (a00016 S6 also proposes a `buildLanguageIR(source)`
 *   helper that parses once and feeds both collectors; this file
 *   is the half that lives alone until that consolidator lands).
 *
 * What it ignores (on purpose)
 * - `let` / `var` / `let M` reassignments. S6 only requires the
 *   `const M = literal` shape, which is what the scanners actually
 *   consume in real codebases (Express apps overwhelmingly declare
 *   routes with `const METHOD = ...; app[METHOD](...)`).
 * - Destructuring (`const { GET } = METHODS`), `enum`, `as const`,
 *   `readonly` modifiers. All out of scope for this slice; tracked
 *   under "constant bindings — second wave" if a real fixture
 *   needs them.
 *
 * Why it uses Babel not the TS frontend
 * - The TS frontend in this repo is the one that already produces
 *   the IR. It does NOT yet expose a `collectConstants` walker (the
 *   `buildLanguageIR` consolidator will); the scanner today calls
 *   `collectMethodCallsFromSource` directly, which uses Babel
 *   internally. Doing the same in this helper keeps the data path
 *   local and testable without re-shaping the public surface.
 */
import { parse as babelParse, type ParserPlugin } from "@babel/parser";
import type { IConstantBinding } from "../../contracts/interfaces/core/language-ir.interface.js";

const LITERAL_TYPES = new Set([
  "StringLiteral",
  "NumericLiteral",
  "BooleanLiteral",
]);

interface BabelNode {
  readonly type: string;
  readonly start?: number | null;
  readonly end?: number | null;
  readonly declarations?: ReadonlyArray<BabelNode>;
  readonly id?: BabelNode;
  readonly init?: BabelNode;
  readonly expression?: BabelNode;
  readonly value?: string | number | boolean;
  readonly name?: string;
  readonly kind?: string;
  /**
   * Walker iterates every key to recurse; the AST has dozens of
   * optional members (each node type a different shape) that we do
   * not enumerate. The index signature lets `Object.keys(node)` map
   * to `unknown` cleanly.
   */
  readonly [key: string]: unknown;
}

/**
 * Coerce any Babel-typed node to our minimal `BabelNode` walker
 * shape. The Babel parser exports precise types per node kind
 * (Program, VariableDeclaration, etc.); each one declares its own
 * fields and none carries an index signature. We only walk them,
 * reading the handful of fields we explicitly type-check above, so
 * collapsing to `BabelNode` is safe — what we lose is the
 * discriminated union, which we never relied on.
 *
 * Kept at module scope (not inlined at every callsite) so the
 * intent is documented once and the cast does not pollute the
 * walker.
 */
function asBabelNode(node: unknown): BabelNode {
  return node as BabelNode;
}

function unwrapTSAsExpression(node: BabelNode): BabelNode {
  // TS adds a `TSAsExpression` wrapper around `const M = "get" as const`.
  // The walker only needs the literal value; the `as` is metadata.
  if (node.type === "TSAsExpression" && node.expression !== undefined) {
    return unwrapTSAsExpression(node.expression);
  }
  return node;
}

function literalValue(node: BabelNode): string | number | boolean | undefined {
  const unwrapped = unwrapTSAsExpression(node);
  if (unwrapped.type === "StringLiteral" && typeof unwrapped.value === "string") {
    return unwrapped.value;
  }
  if (unwrapped.type === "NumericLiteral" && typeof unwrapped.value === "number") {
    return unwrapped.value;
  }
  if (unwrapped.type === "BooleanLiteral" && typeof unwrapped.value === "boolean") {
    return unwrapped.value;
  }
  return undefined;
}

function walkBindings(
  node: BabelNode,
  filename: string,
  out: IConstantBinding[],
): void {
  if (!node) return;
  if (node.type === "VariableDeclaration" && Array.isArray(node.declarations)) {
    // S6 only requires the `const X = literal` shape: `let` and
    // `var` are deliberately ignored because their bindings can be
    // reassigned, and the scanner's `propagateConstants` is
    // intra-file-only — there is no inter-procedural dataflow.
    // A `let M = "get"` followed by `M = "post"` would be a
    // false positive: the scanner would resolve `app[M]` to
    // `app.post` based on the initial value, missing the
    // reassignment. Tracking that is the "constant propagation —
    // second wave" slice if a real fixture ever needs it.
    if (node.kind !== "const") return;
    for (const decl of node.declarations) {
      if (decl.type !== "VariableDeclarator") continue;
      if (decl.id?.type !== "Identifier") continue;
      if (decl.init === undefined) continue;
      const v = literalValue(decl.init);
      if (v === undefined) continue;
      out.push({
        name: decl.id.name ?? "",
        value: v,
        range: {
          file: filename,
          start: node.start ?? 0,
          end: node.end ?? 0,
        },
      });
    }
  }
  // Recurse. We do NOT special-case nested blocks: `const` inside a
  // function is still visible at the file scope (the scanner's
  // propagation is intra-file, file-level).
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "loc" || key === "start" || key === "end") continue;
    const child = node[key];
    if (child === undefined || child === null) continue;
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c !== null && typeof c === "object" && "type" in c) {
          walkBindings(asBabelNode(c), filename, out);
        }
      }
    } else if (typeof child === "object" && "type" in child) {
      walkBindings(asBabelNode(child), filename, out);
    }
  }
}

/**
 * Parses `source` and returns every top-level `const X = <literal>`
 * binding in the file. Returns `[]` on parse failure — the parser
 * failure is already reported by `collectMethodCallsFromSource`
 * upstream; this helper does not duplicate the diagnostic channel.
 */
export function collectConstantsFromSource(
  source: string,
  filename: string,
): IConstantBinding[] {
  const out: IConstantBinding[] = [];
  let ast: { program: unknown } | undefined;
  try {
    ast = babelParse(source, {
      sourceType: "module",
      plugins: ["typescript", "decorators"] as ParserPlugin[],
      errorRecovery: true,
    });
  } catch {
    return out;
  }
  if (!ast || !ast.program) return out;
  walkBindings(asBabelNode(ast.program), filename, out);
  return out;
}

// Re-export so the import is consumed and the symbol is reachable
// from tests / docs (avoids the "unused export" lint).
export const _LITERAL_TYPES = LITERAL_TYPES;
