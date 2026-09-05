/**
 * `propagateConstants` — intraprocedural constant propagation.
 *
 * (a00016 S4) Closes the last gap of the 6 LanguageIR styles:
 * `const M = "get"; app[M]("/x", h)`. The multi-style collector (S2)
 * recognises the shape `app[M]` as `receiverKind: "computed"` with
 * `method: ""` and `callee: "app[M]"`. Here we check whether `M`
 * appears in an `IConstantBinding`, and if it does, we fill
 * `resolvedMethod` with the literal value.
 *
 * Rules (a00016 non-goals, audited):
 *
 *   - We only propagate **direct literals**: `const M = "get"`.
 *   - We do **NOT** propagate concatenations (`const M = "GET" + suffix`).
 *   - We do **NOT** propagate template literals (`` const M = `get` ``).
 *   - We do **NOT** propagate expressions (`` const M = otherVar ``).
 *
 * The limit is on purpose: an approximate propagation would generate
 * false positives. Scanners don't need 100 % of cases — they need to
 * know that when they see `app[M]()` and `M` is a literal, the
 * method is safe.
 *
 * The result: for each `IRouteCallExpression` whose property is
 * `app[M]` and `M` matches an `IConstantBinding` with a literal
 * value, `resolvedMethod = String(value)` is filled in. Scanners look
 * at `method || resolvedMethod` to get the final method.
 *
 * What the module does NOT do:
 *   - Does not resolve scopes (closures, nested functions, recursion).
 *   - Does not resolve `const M = factory()` — factories always stay
 *     as `unknown` in `IConstantBinding.value` (they are not emitted).
 *   - Does not distinguish `const` from `let` or `var`. `let M = "get"`
 *     is also propagated if nobody reassigns (heuristic, not certified).
 */

import type {
  IConstantBinding,
  IRouteCallExpression,
} from "../../contracts/interfaces/core/language-ir.interface.js";

/**
 * Resolves computed properties against a map of literal constants.
 *
 * For each `IRouteCallExpression`:
 *
 *   - If the `callee` has the shape `receiver[X]` (with X an
 *     identifier) and an `IConstantBinding` exists with
 *     `name: "X"` and a literal value (`string | number | boolean`),
 *     `resolvedMethod = String(value)` is filled in.
 *   - Otherwise, the call passes through as-is (the scanner discards it).
 *
 * Returns a NEW array — does not mutate the input.
 */
export function propagateConstants(
  calls: ReadonlyArray<IRouteCallExpression>,
  bindings: ReadonlyArray<IConstantBinding>,
): IRouteCallExpression[] {
  // Build a `name → value` map for O(1) lookup. If there are duplicate
  // bindings with the same name, the last one wins (this is the typical
  // shadowing behaviour in a single file).
  const map = new Map<string, string | number | boolean>();
  for (const binding of bindings) {
    // `IConstantBinding.value` is already typed as
    // `string | number | boolean`, but the defensive cast protects
    // against external inputs that don't honour the contract.
    const value = binding.value;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      map.set(binding.name, value);
    }
  }

  const out: IRouteCallExpression[] = [];
  for (const call of calls) {
    const resolved = resolveOne(call, map);
    out.push(resolved ?? call);
  }
  return out;
}

/**
 * Tries to resolve a single call.
 *
 * Only two `receiverKind` values benefit:
 *   - `"computed"` — `app["get"]` (literal) or `app[M]` (identifier).
 *   - `"optional"` — `app?.["get"]` or `app?.[M]`.
 *
 * If the property is already a known `method` (non-computed identifier
 * case), there's nothing to propagate: the caller already has the
 * method.
 */
function resolveOne(
  call: IRouteCallExpression,
  map: ReadonlyMap<string, string | number | boolean>,
): IRouteCallExpression | null {
  // Only computed (with literal or identifier) and optional enter here.
  // The rest of the `receiverKind` values already have `method` resolved.
  if (call.receiverKind !== "computed" && call.receiverKind !== "optional") {
    return null;
  }

  // If `method` is filled, the property was already a literal and the
  // caller doesn't need propagation. This happens when S2 recognised
  // `server["get"]` directly.
  if (call.method !== "") {
    return null;
  }

  // For `app[M]`, the `callee` emitted by S2 is `"app[M]"`. We look
  // for the identifier between the brackets.
  const match = /\[\s*([A-Za-z_$][\w$]*)\s*\]$/.exec(call.callee);
  if (!match) {
    // `app["get"]` (direct string literal) — already covered by the
    // early return above. If we get here, the callee doesn't end in
    // `[X]`; without more info we don't propagate.
    return null;
  }
  const propName = match[1];
  if (!propName) return null;
  const value = map.get(propName);
  if (value === undefined) return null;

  return {
    ...call,
    resolvedMethod: String(value),
  };
}
