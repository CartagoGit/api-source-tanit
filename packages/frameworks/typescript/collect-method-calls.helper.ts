/**
 * `collectMethodCalls` — a `CallExpression` from the TS AST viewed
 * from the multi-style frameworks adapter.
 *
 * (a00016 S2) Replaces the simple `Identifier.method` extraction the
 * TS frontend used to do (`packages/core/language-frontends/typescript/
 * typescript.parser.ts` → `collectMethodCalls`). The difference is the
 * number of *callee* shapes it recognises:
 *   - `app.get(...)`             → receiverKind="identifier".
 *   - `this.router.get(...)`     → receiverKind="this".
 *   - `api.router.get(...)`      → receiverKind="member".
 *   - `getRouter().get(...)`     → receiverKind="factory".
 *   - `server["get"](...)`       → receiverKind="computed".
 *   - `router?.get(...)`         → receiverKind="optional".
 *
 * The TS frontend only recognises `Identifier.method` (the first one),
 * so the remaining 5 styles were invisible to the 6 TS-flavoured
 * scanners. This is the module that makes them visible, exposing an
 * `IRouteCallExpression[]` that scanners consume.
 *
 * Why it is NOT added to the frontend's `TSFile`:
 *   - Same argument as `tagged-template.ts` (a00015 S1): the frontend
 *     is framework-agnostic. A multi-style collector that knows what
 *     counts as a "route callee" is logic of the frameworks adapter,
 *     not the language frontend.
 *   - The frontend keeps producing its `methodCalls: TSMethodCall[]`
 *     untouched: scanners that did NOT migrate (none yet) keep working
 *     exactly as before.
 *
 * It reuses `@babel/parser` and `@babel/traverse` already in the
 * lockfile (`@babel/parser@7.29.8` from the TS frontend;
 * `@babel/traverse` from the same transitive dependency). The pattern
 * is the same as `tagged-template.ts`: permissive cast to `BabelNode`,
 * stack-based DFS walker, `errorRecovery: true` so a weird file does
 * not abort the scan.
 *
 * What the module does NOT do (a00016 non-goals):
 *   - Does not resolve types.
 *   - Does not follow imports (S3 — `symbol-resolver.ts` does).
 *   - Does not propagate constants (S4 — `constant-propagation.ts` does).
 *   - Does not replace the frontend's `collectMethodCalls`; it
 *     coexists with it.
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { parse as babelParse, type ParserPlugin } from "@babel/parser";

import type { IParseDiagnostic } from "../../contracts/interfaces/core/scanner.interface.js";
import type {
  IRouteCallExpression,
  ReceiverKind,
} from "../../contracts/interfaces/core/language-ir.interface.js";
import type { TSLiteral } from "../../contracts/interfaces/core/language/typescript-frontend-literal.interface.js";
import { collectFiles, isSourceJsTsFile } from "../../core/helpers/fs-walk.helper.js";

// ---------------------------------------------------------------------------
// Babel node helpers — same pattern as `tagged-template.ts` and the TS
// frontend. The idea is the same: don't import `@babel/types`, treat
// the AST as `{ type: string, [k: string]: unknown }` and read what
// we need with `asBabelNode`.
// ---------------------------------------------------------------------------

interface BabelNode {
  readonly type: string;
  readonly start?: number | null;
  readonly end?: number | null;
  readonly [key: string]: unknown;
}

function asBabelNode(value: unknown): BabelNode {
  return value as BabelNode;
}

function asArray(value: unknown): ReadonlyArray<BabelNode> {
  return Array.isArray(value) ? (value as ReadonlyArray<BabelNode>) : [];
}

function isJsxFile(filename: string): boolean {
  return filename.endsWith(".tsx") || filename.endsWith(".jsx");
}

// ---------------------------------------------------------------------------
// Source helpers
// ---------------------------------------------------------------------------

/** Text of `Identifier.name` (empty if not applicable). */
function identName(node: BabelNode): string {
  const raw = node.name;
  return typeof raw === "string" ? raw : "";
}

/** Text of `StringLiteral.value` (empty if not applicable). */
function stringLiteralValue(node: BabelNode): string {
  const raw = node.value;
  return typeof raw === "string" ? raw : "";
}

// ---------------------------------------------------------------------------
// Callee decomposition
// ---------------------------------------------------------------------------

/**
 * Canonical callee shape, once decomposed.
 *
 * `prefix` is the string that goes BEFORE the method (`"app"`,
 * `"this.router"`, `"getRouter()"`, etc.). The scanner that wants to
 * reproduce the original code uses `prefix + "." + method` — except
 * when `method` is empty (the `computed` case with a string literal),
 * where the shape is `prefix + '["' + resolvedMethod + '"]'`.
 *
 * `memberIsComputed` indicates that the property was computed (string
 * literal or identifier). The scanner that needs to propagate the
 * constant looks at it; the rest can ignore it because `method` always
 * stays empty in that case (S4 resolves it).
 *
 * `propertyIdentifier` is the identifier's name when the computed
 * property was an Identifier (`app[M]`). The walker uses it to
 * reconstruct the textual `callee` as `"app[M]"`, which S4
 * (`propagateConstants`) inspects to resolve.
 */
interface ICalleeShape {
  readonly prefix: string;
  readonly method: string;
  readonly memberIsComputed: boolean;
  readonly propertyIdentifier: string;
  readonly receiverKind: ReceiverKind;
}

/**
 * Descompone el `callee` de una `CallExpression` en las 6 formas que
 * soporta `IRouteCallExpression.receiverKind`.
 *
 * Estructura del callee en cada caso:
 *
 *   - `app.get(...)`              → `MemberExpression { object: Identifier("app"), property: Identifier("get") }`.
 *   - `this.router.get(...)`      → `MemberExpression { object: MemberExpression { object: ThisExpression, property: Identifier("router") }, property: Identifier("get") }`.
 *   - `api.router.get(...)`       → `MemberExpression { object: MemberExpression { object: Identifier("api"), property: Identifier("router") }, property: Identifier("get") }`.
 *   - `getRouter().get(...)`      → `MemberExpression { object: CallExpression { callee: Identifier("getRouter") }, property: Identifier("get") }`.
 *   - `server["get"](...)`        → `MemberExpression { object: Identifier("server"), property: StringLiteral("get"), computed: true }`.
 *   - `router?.get(...)`          → `OptionalMemberExpression { object: Identifier("router"), property: Identifier("get") }`.
 *
 * Devuelve `null` cuando el callee no encaja en ninguna de las 6
* bare `CallExpression`, `NewExpression`,
 * `OptionalCallExpression`). Adapters that only care about routes
 * can ignore the `null` and move on.
 */
function decomposeCallee(callee: BabelNode): ICalleeShape | null {
  // Case 1: classic `MemberExpression`.
  if (callee.type === "MemberExpression") {
    const computed = callee.computed === true;
    const property = asBabelNode(callee.property);
    const object = asBabelNode(callee.object);

    if (computed && property.type === "StringLiteral") {
      // `server["get"](...)` — receiverKind="computed" because the
      // property is a computed string literal, not an identifier.
      return {
        prefix: renderReceiver(object),
        method: stringLiteralValue(property),
        memberIsComputed: true,
        propertyIdentifier: "",
        receiverKind: "computed",
      };
    }

    if (computed && property.type === "Identifier") {
      // `app[M](...)` — computed property with an identifier. The
      // method stays empty here; S4 (`propagateConstants`) will
      // resolve it if `M` is a literal constant. If not, the scanner
      // discards the call.
      const propName = identName(property);
      return {
        prefix: renderReceiver(object),
        method: "",
        memberIsComputed: true,
        propertyIdentifier: propName,
        receiverKind: "computed",
      };
    }

    if (!computed && property.type === "Identifier") {
      const method = identName(property);
      if (!method) return null;
      return {
        prefix: renderReceiver(object),
        method,
        memberIsComputed: false,
        propertyIdentifier: "",
        // We count the depth of the entire CALLEE: `app.get` is 1
        // level (identifier), `api.router.get` is 2 (member),
        // `this.router.get` is 2 with a `this` root (this).
        receiverKind: calleeReceiverKind(callee),
      };
    }

    // Shapes that don't fit: spread, assignment as property, etc.
    return null;
  }

  // Caso 2: `OptionalMemberExpression` — `router?.get(...)`.
  // Babel emits it as a separate node, not as `MemberExpression`
  // with `optional: true`. We have to distinguish it so that
  // `receiverKind` becomes "optional" instead of "identifier".
  if (callee.type === "OptionalMemberExpression") {
    const computed = callee.computed === true;
    const property = asBabelNode(callee.property);
    const object = asBabelNode(callee.object);

    if (computed && property.type === "StringLiteral") {
      return {
        prefix: renderReceiver(object),
        method: stringLiteralValue(property),
        memberIsComputed: true,
        propertyIdentifier: "",
        // Optional wins over computed because `?.` is the most
        // distinctive thing about the callee.
        receiverKind: "optional",
      };
    }

    if (computed && property.type === "Identifier") {
      // `app?.[M](...)` — analogous to the computed member case. S4
      // resolves the constant.
      const propName = identName(property);
      return {
        prefix: renderReceiver(object),
        method: "",
        memberIsComputed: true,
        propertyIdentifier: propName,
        receiverKind: "optional",
      };
    }

    if (!computed && property.type === "Identifier") {
      const method = identName(property);
      if (!method) return null;
      return {
        prefix: renderReceiver(object),
        method,
        memberIsComputed: false,
        propertyIdentifier: "",
        receiverKind: "optional",
      };
    }
    return null;
  }

  // Any other shape (`CallExpression`, bare `Identifier`,
  // `NewExpression`, ...) does not enter the IR — we return null and
  // the collector ignores it.
  return null;
}

/**
 * Readable string for the receiver. Scanners use it to reproduce the
 * original code (`callee = prefix + "." + method`).
 *
 * - `Identifier("app")`         → `"app"`.
 * - `ThisExpression`            → `"this"`.
 * - Nested `MemberExpression`   → `"api.router"` (recursive).
 * - `CallExpression`            → `"getRouter()"` (the whole call).
 * - Other                       → `""` (unknown; scanners can use
 *   `receiverKind` to get more info if they need it).
 */
function renderReceiver(node: BabelNode): string {
  if (node.type === "Identifier") return identName(node);
  if (node.type === "ThisExpression") return "this";
  if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
    const object = asBabelNode(node.object);
    const property = asBabelNode(node.property);
    const sep = node.type === "OptionalMemberExpression" ? "?." : ".";
    const computed = node.computed === true;
    if (computed && property.type === "StringLiteral") {
      return `${renderReceiver(object)}${sep}["${stringLiteralValue(property)}"]`;
    }
    if (!computed && property.type === "Identifier") {
      return `${renderReceiver(object)}${sep}${identName(property)}`;
    }
    return "";
  }
  if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
    const innerCallee = asBabelNode(node.callee);
    return `${renderReceiver(innerCallee)}()`;
  }
  return "";
}

/**
 * Classifies the **immediate object** of the callee into one of the
 * `ReceiverKind`s to report to the caller.
 *
 * This function is NOT used directly — `rootReceiverKind` (below)
 * prefers it, because what distinguishes `this.router.get` from
 * `api.router.get` is the BOTTOM of the chain, not the immediate node.
 * We leave it for adapters that want to classify the `object`
 * locally.
 *
 * - `Identifier` → "identifier".
 * - `ThisExpression` → "this".
 * - `MemberExpression` (not computed) → "member".
 * - `MemberExpression` with `computed: true` → "computed" if the
 *   property is a string literal.
 * - `OptionalMemberExpression` → "optional".
 * - `CallExpression` / `OptionalCallExpression` → "factory".
 * - Other → "member" (conservative fallback).
 */
function receiverKindOf(node: BabelNode): ReceiverKind {
  if (node.type === "Identifier") return "identifier";
  if (node.type === "ThisExpression") return "this";
  if (node.type === "OptionalMemberExpression") return "optional";
  if (node.type === "CallExpression" || node.type === "OptionalCallExpression") return "factory";
  if (node.type === "MemberExpression") {
    if (node.computed === true) {
      const property = asBabelNode(node.property);
      if (property.type === "StringLiteral") return "computed";
    }
    return "member";
  }
  return "member";
}

/**
 * Classifies the CALLEE (not just the immediate `object`) into one
 * of the `ReceiverKind`s for `MemberExpression`/`OptionalMemberExpression`.
 *
 * Counts the chain's depth and looks at the bottom:
 *
 *   - `app.get`              → 1-level MemberExpression, bottom
 *                              Identifier → "identifier".
 *   - `api.router.get`       → 2-level MemberExpression, bottom
 *                              Identifier → "member".
 *   - `this.router.get`      → 2 levels, bottom ThisExpression →
 *                              "this".
 *   - `getRouter().get`      → 1-level MemberExpression whose object
 *                              is a CallExpression → "factory".
 *   - `server["get"]`        → 1-level MemberExpression with computed
 *                              string literal → "computed".
 *
 * Why we count the CALLEE and not just the `object`: for
 * `api.router.get`, the immediate `object` is `api.router` (another
 * MemberExpression). If we classify the `object` with
 * `receiverKindOf` we get "member", but the correct answer depends on
 * the WHOLE callee. Walking from the callee and counting nested
 * MemberExpressions gives the right answer.
 */
function calleeReceiverKind(callee: BabelNode): ReceiverKind {
  // "Strong" cases detected without counting: the bottom is already a
  // CallExpression, a computed string literal, or a ThisExpression.
  if (callee.type === "OptionalMemberExpression") return "optional";
  if (callee.type !== "MemberExpression") return receiverKindOf(callee);

  // If the property is a computed string literal, the callee IS
  // `server["get"]` and the property wins.
  const computed = callee.computed === true;
  const property = asBabelNode(callee.property);
  if (computed && property.type === "StringLiteral") return "computed";

  // We walk the chain counting levels and looking at the bottom.
  let depth = 0;
  let cursor: BabelNode = callee;
  while (cursor.type === "MemberExpression") {
    const isComputed = cursor.computed === true;
    const prop = asBabelNode(cursor.property);
    if (isComputed || prop.type !== "Identifier") break;
    depth += 1;
    cursor = asBabelNode(cursor.object);
  }

  // Special bottom: `this` or a call.
  if (cursor.type === "ThisExpression") return "this";
  if (cursor.type === "CallExpression" || cursor.type === "OptionalCallExpression") return "factory";

  // Identifier bottom: 1 level → identifier, 2+ → member.
  if (depth === 1) return "identifier";
  if (depth >= 2) return "member";

  // We couldn't walk — fall back to the local classifier of the bottom.
  return receiverKindOf(cursor);
}

// ---------------------------------------------------------------------------
// Argument extraction
// ---------------------------------------------------------------------------

/**
 * Converts an AST argument into a reduced `TSLiteral`.
 *
 * It does NOT reuse `literalFromNode` from the TS frontend — that
 * lives in `core/language-frontends/typescript/`, and `frameworks/`
 * must not import from `core/` per the a00010 invariant. This version
 * covers the minimum TS scanners need (string/number/boolean,
 * identifier, null/undefined, arrow) and returns `kind: "unknown"`
 * for the rest (object literal, array, spread, call).
 *
 * If a scanner needs something richer, this is the place to extend —
 * but `unknown` is honest: if the shape doesn't fit, the adapter
 * discards it and the caller knows it has to look elsewhere to get
 * the information.
 */
function literalFromArg(node: BabelNode): TSLiteral {
  if (node.type === "StringLiteral") {
    const value = stringLiteralValue(node);
    return { kind: "string", value };
  }
  if (node.type === "NumericLiteral") {
    const raw = node.value;
    const value = typeof raw === "number" ? raw : Number(raw);
    return { kind: "number", value: Number.isFinite(value) ? value : 0 };
  }
  if (node.type === "BooleanLiteral") {
    const raw = node.value;
    return { kind: "boolean", value: raw === true };
  }
  if (node.type === "NullLiteral") return { kind: "null" };
  if (node.type === "Identifier" && node.name === "undefined") {
    return { kind: "undefined" };
  }
  if (node.type === "Identifier") {
    const name = identName(node);
    return { kind: "identifier", identifierName: name };
  }
  // Arrow functions: capture the bodyRange as the frontend does.
  if (node.type === "ArrowFunctionExpression") {
    const body = asBabelNode(node.body);
    const start = typeof body.start === "number" ? body.start : 0;
    const end = typeof body.end === "number" ? body.end : start;
    return { kind: "arrow", bodyRange: { start, end } };
  }
  // The rest (ObjectExpression, ArrayExpression, SpreadElement, nested
  // CallExpression, ...) becomes "unknown" — scanners that need this
  // will have their own adapter.
  return { kind: "unknown" };
}

/** Extrae los argumentos de un nodo `CallExpression`. */
function extractArgs(node: BabelNode): ReadonlyArray<TSLiteral> {
  const argsRaw = asArray(node.arguments);
  const out: TSLiteral[] = [];
  for (const arg of argsRaw) out.push(literalFromArg(arg));
  return out;
}

// ---------------------------------------------------------------------------
// Walker
// ---------------------------------------------------------------------------

/**
 * DFS over the AST that visits each node exactly once.
 *
 * Same pattern as `walk` in the frontend: visits EVERYTHING without
 * pruning, and the collectors decide what they care about. Here we
 * only care about `CallExpression`s whose callee fits one of the 6
 * shapes — the rest is discarded.
 */
function walkBody(
  body: ReadonlyArray<BabelNode>,
  sourceFile: string,
  out: IRouteCallExpression[],
): void {
  // We initialise the stack in reverse order so the first node of
  // `body` is processed first when we `pop()`. The result is a
  // top-down traversal of the file: calls are emitted in the order
  // they appear in the code, which is what scanners expect to
  // correlate routes with lines.
  const stack: BabelNode[] = [...body].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;

    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
      const callee = asBabelNode(node.callee);
      const shape = decomposeCallee(callee);
      if (shape) {
        const start = typeof node.start === "number" ? node.start : 0;
        const end = typeof node.end === "number" ? node.end : start;
        const args = extractArgs(node);
        const calleeText = shape.memberIsComputed
          ? shape.propertyIdentifier
            ? `${shape.prefix}[${shape.propertyIdentifier}]`
            : `${shape.prefix}["${shape.method}"]`
          : shape.method
            ? `${shape.prefix}.${shape.method}`
            : shape.prefix;
        out.push({
          callee: calleeText,
          receiverKind: shape.receiverKind,
          receiver: shape.prefix,
          method: shape.method,
          args,
          range: { file: sourceFile, start, end },
        });
      }
    }

    // Hijos: cualquier campo que sea objeto/array con `type`. El
    // recorrido es DFS en preorden (top-down), igual que el frontend.
    // Metemos los hijos en orden INVERSO al stack para que el primer
    // hijo salga primero al hacer `pop()` — preservando el orden del
    // archivo en el output.
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
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) stack.push(child);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parsea un archivo TS/JS y devuelve sus `IRouteCallExpression`.
 *
 * Si Babel no puede parsear el archivo, registra el motivo en
 * `diagnostics` (si vino) y devuelve `[]`. Mismo contrato que
 * `collectTaggedTemplatesFromSource` y `parseModule`: degradar sin
 * ruido en vez de abortar el scan.
 */
export function collectMethodCallsFromSource(
  source: string,
  filename: string,
  diagnostics?: Array<IParseDiagnostic>,
): IRouteCallExpression[] {
  const plugins: ParserPlugin[] = ["typescript", "decorators"];
  if (isJsxFile(filename)) plugins.push("jsx");

  try {
    const ast = babelParse(source, {
      sourceType: "module",
      allowImportExportEverywhere: true,
      plugins: [...plugins],
      errorRecovery: true,
    });
    const body = asArray(ast.program["body"]);
    const out: IRouteCallExpression[] = [];
    walkBody(body, filename, out);
    return out;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    diagnostics?.push({ file: filename, severity: "error", reason });
    return [];
  }
}

/**
 * Walks the TS/JS source under `projectRoot` and returns all the
 * `IRouteCallExpression`s it finds.
 *
 * Uses `collectFiles(projectRoot, isSourceJsTsFile)` — the same helper
 * as `tagged-template.ts`, `express.scanner.ts`, and
 * `graphql.scanner.ts` — so it honours the same excludes
 * (`node_modules`, `dist`, etc.).
 *
 * `diagnostics` (optional) receives the files the parser could not
 * digest. If not passed, failures are swallowed silently.
 */
export async function collectMethodCalls(
  projectRoot: string,
  diagnostics?: Array<IParseDiagnostic>,
): Promise<IRouteCallExpression[]> {
  const files = await collectFiles(projectRoot, isSourceJsTsFile);
  const out: IRouteCallExpression[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const rel = relative(projectRoot, file) || file;
    out.push(...collectMethodCallsFromSource(text, rel, diagnostics));
  }
  return out;
}
