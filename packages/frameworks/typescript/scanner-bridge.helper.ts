/**
 * `scanner-bridge` — adapts the LanguageIR (S2+S3+S4) to the
 * `TSMethodCall` shape consumed by the 6 TS-flavored scanners.
 *
 * (a00016 S5) The Express, NestJS, Fastify, Hono, Next.js, and tRPC
 * scanners used to read `ast.methodCalls` from the TS frontend
 * (a00010 S7). That shape is a subset of the new LanguageIR: it
 * covers only `Identifier.method` and leaves out `this.router.get`,
 * `server["get"]`, `app[M]`, etc.
 *
 * This module is the **adapter** that translates `IRouteCallExpression[]`
 * (multi-style) into `TSMethodCall[]` (legacy single-style), so the
 * route-extraction logic inside each scanner
 * (`for (const call of ast.methodCalls) { ... }`) keeps working
 * without being rewritten. The difference is that the scanner now
 * sees calls that used to be invisible.
 *
 * Why scanners are NOT rewritten to consume `IRouteCallExpression`
 * directly:
 *   - 6 scanners × 200–700 lines each = ~3000 lines of code to
 *     touch. The bridge is ~150 lines.
 *   - The `TSMethodCall` shape already has `args: TSLiteral[]`,
 *     `line`/`column`, and `bodyRange`. The only thing that changes
 *     with the LanguageIR is `callee` (multi-segment vs simple
 *     "app.get") and the presence of `resolvedMethod` (S4) — which
 *     the bridge flattens before delivering.
 *
 * What the module DOES:
 *   - Builds the canonical `callee` `"receiver.method"`.
 *   - If `resolvedMethod` is present (S4), uses it as `method`.
 *   - Converts the byte offset to `(line, column)` 1-based.
 *
 * What the module does NOT do:
 *   - Does not replace the TS frontend: the frontend keeps producing
 *     `TSFile` with `imports`, `assignments`, `classes`, `decorators`
 *     for the scanners that need them (NestJS, Next.js, tRPC). Only
 *     the `methodCalls` part is redirected to the LanguageIR.
 *   - Does not resolve types or scopes — S2/S3/S4 already did their work.
 */

import type { TSMethodCall } from "../../contracts/interfaces/core/language/typescript-frontend.interface.js";
import type { TSLiteral } from "../../contracts/interfaces/core/language/typescript-frontend-literal.interface.js";
import type { IRouteCallExpression } from "../../contracts/interfaces/core/language-ir.interface.js";

/**
 * Converts a 0-based byte offset in `source` to `(line, column)`
 * 1-based (line) / 0-based (column) — the same shape as
 * `TSMethodCall.line` / `column`.
 *
 * If the offset falls outside the range, returns
 * `{ line: 1, column: 0 }` (the TS frontend's default position).
 */
function offsetToPosition(source: string, offset: number): { line: number; column: number } {
  if (offset < 0 || offset > source.length) return { line: 1, column: 0 };
  let line = 1;
  let column = 0;
  for (let i = 0; i < offset; i++) {
    const ch = source.charCodeAt(i);
    if (ch === 10) {
      // `\n` (LF).
      line += 1;
      column = 0;
      continue;
    }
    if (ch === 13) {
      // `\r` or `\r\n` — count `\r` as a line break, but if followed
      // by `\n` we don't add another line.
      line += 1;
      column = 0;
      if (i + 1 < offset && source.charCodeAt(i + 1) === 10) i += 1;
      continue;
    }
    column += 1;
  }
  return { line, column };
}

/**
 * Resolves the canonical `callee` `"receiver.method"` for an
 * `IRouteCallExpression`.
 *
 * Three cases:
 *   - `method` non-empty → `${prefix}.${method}` (with the prefix
 *     already in `callee` when it's not computed, or reconstructed).
 *   - `method` empty + `resolvedMethod` (S4) → `prefix[resolvedMethod]`
 *     (shape of the textual callee with brackets).
 *   - `method` empty without resolution → returns `callee` as-is
 *     (the scanner discards it).
 */
function resolveCanonicalCallee(expr: IRouteCallExpression): string {
  // If `method` is filled, we already have the canonical shape in
  // `callee` (S2 emits it as `"receiver.method"`). We return it
  // untouched.
  if (expr.method) {
    return expr.callee;
  }
  // `resolvedMethod` (S4) can save a callee that looked unresolvable.
  // We emit `"receiver[method]"` to keep the textual cue that it
  // was computed.
  if (expr.resolvedMethod) {
    // `callee` already has the shape `"app[M]"` (S2). We replace the
    // identifier between brackets with the resolved value.
    return expr.callee.replace(/\[[^\]]+\]$/, `["${expr.resolvedMethod}"]`);
  }
  // Unresolved: return the original callee. The scanner discards it
  // because `split(".")` yields a piece without a method.
  return expr.callee;
}

/**
 * Converts `IRouteCallExpression[]` into the `TSMethodCall[]` shape
 * that the TS-flavored scanners consume.
 *
 * The output order matches the input (top-down per file), preserved
 * by S2. Scanners that sort by line can use the resulting `line`
 * directly.
 */
export function toTSMethodCalls(
  calls: ReadonlyArray<IRouteCallExpression>,
  source: string,
): TSMethodCall[] {
  const out: TSMethodCall[] = [];
  for (const expr of calls) {
    const callee = resolveCanonicalCallee(expr);
    // If there's no method (neither `method` nor `resolvedMethod`)
    // and the `callee` doesn't contain a dot, the scanner can't do
    // anything with this. We silently discard it.
    if (!callee.includes(".") && !callee.includes("[")) continue;
    const { line, column } = offsetToPosition(source, expr.range.start);
    const args: TSLiteral[] = expr.args.map((arg) => ({
      kind: arg.kind,
      ...(arg.value !== undefined ? { value: arg.value } : {}),
      ...(arg.identifierName !== undefined ? { identifierName: arg.identifierName } : {}),
      ...(arg.objectShape !== undefined ? { objectShape: arg.objectShape } : {}),
      ...(arg.arrayItems !== undefined ? { arrayItems: arg.arrayItems } : {}),
      ...(arg.bodyRange !== undefined ? { bodyRange: arg.bodyRange } : {}),
    }));
    out.push({
      callee,
      args,
      line,
      column,
    });
  }
  return out;
}
