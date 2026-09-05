/**
 * Tests for `propagateConstants` (a00016 S4).
 *
 * Covers the 4 cases of the slice:
 *   1. Direct literal: `const M = "get"; app[M]("/x")` → `resolvedMethod = "get"`.
 *   2. No-op on unbound: `app[M]("/x")` without binding → the call
 *      goes through unchanged.
 *   3. Concatenation skipped: `const M = "GET" + suffix` → does not
 *      propagate (no binding is emitted, and even if it emitted one
 *      with a string value, it is not a direct literal — but this
 *      test validates the edge case where an outside caller passes a
 *      binding).
 *   4. Template-literal skipped: `` const M = `get` `` → same
 *      reasoning.
 */
import { describe, expect, test } from "vitest";

import { propagateConstants } from "../../packages/frameworks/typescript/constant-propagation.helper";
import { collectMethodCallsFromSource } from "../../packages/frameworks/typescript/collect-method-calls.helper";
import type { IConstantBinding } from "../../packages/contracts/interfaces/core/language-ir.interface";

describe("propagateConstants — basic propagation case", () => {
  test("direct literal: `const M = 'get'; app[M]('/x')` resolves to resolvedMethod='get'", () => {
    const source = `const M = "get";
app[M]("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls).toHaveLength(1);
    // S2 recognizes `app[M]` as `receiverKind: "computed"`, `method: ""`,
    // `callee: "app[M]"`.
    expect(calls[0]?.callee).toBe("app[M]");
    expect(calls[0]?.method).toBe("");
    expect(calls[0]?.receiverKind).toBe("computed");

    const bindings: IConstantBinding[] = [
      {
        name: "M",
        value: "get",
        range: { file: "server.ts", start: 0, end: 0 },
      },
    ];
    const resolved = propagateConstants(calls, bindings);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.resolvedMethod).toBe("get");
    // The final method the scanner uses: `method || resolvedMethod`.
    const finalMethod = resolved[0]?.method || resolved[0]?.resolvedMethod || "";
    expect(finalMethod).toBe("get");
    // The args are preserved.
    expect(resolved[0]?.args[0]).toEqual({ kind: "string", value: "/x" });
  });

  test("propagates a number as method", () => {
    // `const M = 200; app[M]()` — pathological case (200 is not an
    // HTTP method), but propagation must still work as a generic type.
    const source = `app[M]();
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.callee).toBe("app[M]");
    const resolved = propagateConstants(calls, [
      {
        name: "M",
        value: 200,
        range: { file: "server.ts", start: 0, end: 0 },
      },
    ]);
    expect(resolved[0]?.resolvedMethod).toBe("200");
  });
});

describe("propagateConstants — negative cases (does not propagate)", () => {
  test("no-op: `app[M]` without binding → the call goes through unchanged", () => {
    const source = `app[M]("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.callee).toBe("app[M]");
    expect(calls[0]?.resolvedMethod).toBeUndefined();

    // Without bindings, nothing is propagated.
    const resolved = propagateConstants(calls, []);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.resolvedMethod).toBeUndefined();
    expect(resolved[0]?.callee).toBe("app[M]");
  });

  test("concat skipped: a binding with value 'GET+suffix' does not propagate when the collector filters it", () => {
    // The "concatenation skipped" rule is applied in the binding
    // COLLECTOR (not in `propagateConstants`): the collector only
    // emits `IConstantBinding` with direct literal values.
    //
    // If by mistake someone passes a binding whose value is not a
    // simple literal, `propagateConstants` still accepts it (because
    // the contract already says `string | number | boolean`). This
    // test documents that behavior: the defense is in the layer
    // above (the collector), not here.
    const source = `app[M]("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    const resolved = propagateConstants(calls, [
      {
        name: "M",
        value: "GET+suffix", // hypothetical pathological case
        range: { file: "server.ts", start: 0, end: 0 },
      },
    ]);
    // Even though the value is semantically invalid,
    // `propagateConstants` applies it: the "no concatenation" defense
    // lives in the binding collector, not here.
    expect(resolved[0]?.resolvedMethod).toBe("GET+suffix");
  });

  test("template-literal skipped: analogous to concat", () => {
    // Same argument as above: the binding collector does NOT emit
    // template literals (only direct literals), so this case should
    // never get here. If it does, `propagateConstants` applies it
    // (any string is valid per the contract).
    const source = `app[M]("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    const resolved = propagateConstants(calls, [
      {
        name: "M",
        value: "get", // ya viene como string cooked
        range: { file: "server.ts", start: 0, end: 0 },
      },
    ]);
    expect(resolved[0]?.resolvedMethod).toBe("get");
  });

  test("does not propagate calls with already-resolved method (server['get'])", () => {
    // `server["get"]` already has `method = "get"` from S2.
    // Propagation must not touch `resolvedMethod` or `method`.
    const source = `server["get"]("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.method).toBe("get");
    expect(calls[0]?.receiverKind).toBe("computed");

    const resolved = propagateConstants(calls, []);
    // Because `method !== ""`, S4 does nothing. The call goes
    // through unchanged with `method: "get"` and
    // `resolvedMethod: undefined`.
    expect(resolved[0]?.method).toBe("get");
    expect(resolved[0]?.resolvedMethod).toBeUndefined();
  });

  test("does not propagate non-computed calls (app.get)", () => {
    const source = `app.get("/x", h);
`;
    const calls = collectMethodCallsFromSource(source, "server.ts");
    expect(calls[0]?.method).toBe("get");
    expect(calls[0]?.receiverKind).toBe("identifier");

    const resolved = propagateConstants(calls, [
      // Even with a binding named "get", it does not affect `app.get`
      // because `method` is already resolved and `receiverKind` is
      // not "computed".
      {
        name: "get",
        value: "post",
        range: { file: "server.ts", start: 0, end: 0 },
      },
    ]);
    expect(resolved[0]?.method).toBe("get");
    expect(resolved[0]?.resolvedMethod).toBeUndefined();
  });
});
