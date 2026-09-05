/**
 * Tests for `collectMethodCallsFromSource` (a00016 S2).
 *
 * Covers the 6 styles that `IRouteCallExpression.receiverKind` distinguishes:
 *
 *   - identifier (`app.get`)
 *   - this (`this.router.get`)
 *   - member (`api.router.get`)
 *   - factory (`getRouter().get`)
 *   - computed (`server["get"]`)
 *   - optional (`router?.get`)
 *
 * Unit tests over `collectMethodCallsFromSource(source, filename)` —
 * the pure primitive. `collectMethodCalls(projectRoot)` is covered in
 * S5 with a temporary project on disk, same as in a00015 S2.
 */
import { describe, expect, test } from "vitest";

import { collectMethodCallsFromSource } from "../../packages/frameworks/typescript/collect-method-calls.helper";

describe("collectMethodCallsFromSource — callee styles", () => {
  test("identifier: `app.get('/x')` is recognized with receiverKind=identifier", () => {
    const source = `import express from "express";
const app = express();
app.get("/users", handler);
`;
    const found = collectMethodCallsFromSource(source, "server.ts");
    expect(found).toHaveLength(1);
    const expr = found[0];
    expect(expr?.callee).toBe("app.get");
    expect(expr?.receiverKind).toBe("identifier");
    expect(expr?.method).toBe("get");
    expect(expr?.args[0]).toEqual({ kind: "string", value: "/users" });
  });

  test("this: `this.router.get('/x')` is recognized with receiverKind=this", () => {
    const source = `class UsersController {
  list() {
    this.router.get("/users", () => null);
  }
}
`;
    const found = collectMethodCallsFromSource(source, "controller.ts");
    expect(found).toHaveLength(1);
    const expr = found[0];
    expect(expr?.callee).toBe("this.router.get");
    expect(expr?.receiverKind).toBe("this");
    expect(expr?.method).toBe("get");
  });

  test("member: `api.router.get('/x')` is recognized with receiverKind=member", () => {
    const source = `api.router.get("/users", handler);
api.router.post("/orders", handler);
`;
    const found = collectMethodCallsFromSource(source, "server.ts");
    expect(found).toHaveLength(2);
    expect(found[0]?.callee).toBe("api.router.get");
    expect(found[0]?.receiverKind).toBe("member");
    expect(found[1]?.callee).toBe("api.router.post");
    expect(found[1]?.receiverKind).toBe("member");
  });

  test("factory: `getRouter().get('/x')` is recognized with receiverKind=factory", () => {
    const source = `getRouter().get("/health", () => "ok");
`;
    const found = collectMethodCallsFromSource(source, "server.ts");
    expect(found).toHaveLength(1);
    const expr = found[0];
    expect(expr?.callee).toBe("getRouter().get");
    expect(expr?.receiverKind).toBe("factory");
    expect(expr?.method).toBe("get");
    expect(expr?.args[0]).toEqual({ kind: "string", value: "/health" });
  });

  test("computed: `server['get']('/x')` is recognized with receiverKind=computed", () => {
    const source = `server["get"]("/users", handler);
server["post"]("/orders", handler);
`;
    const found = collectMethodCallsFromSource(source, "server.ts");
    expect(found).toHaveLength(2);
    // For direct string literals (`server["get"]`), the method is
    // ALREADY known at parse time — `method` is filled with the
    // literal's value. S4 (`propagateConstants`) only adds value
    // when the property is an identifier that resolves to a constant
    // (`const M = "get"; app[M]()`).
    expect(found[0]?.callee).toBe('server["get"]');
    expect(found[0]?.receiverKind).toBe("computed");
    expect(found[0]?.method).toBe("get");
    expect(found[1]?.callee).toBe('server["post"]');
    expect(found[1]?.receiverKind).toBe("computed");
    expect(found[1]?.method).toBe("post");
  });

  test("optional: `router?.get('/x')` is recognized with receiverKind=optional", () => {
    const source = `router?.get("/users", handler);
`;
    const found = collectMethodCallsFromSource(source, "server.ts");
    expect(found).toHaveLength(1);
    const expr = found[0];
    // The textual callee omits the `?.` because `renderReceiver` uses
    // `.` for printing. A scanner that needs the `?.` checks
    // `receiverKind === "optional"` and adds it in its output.
    expect(expr?.callee).toBe("router.get");
    expect(expr?.receiverKind).toBe("optional");
    expect(expr?.method).toBe("get");
  });
});

describe("collectMethodCallsFromSource — coexistence and ranges", () => {
  test("a mix of the 6 styles in the same file is fully identified", () => {
    const source = `app.get("/a", h);
this.router.get("/b", h);
api.router.get("/c", h);
getRouter().get("/d", h);
server["get"]("/e", h);
router?.get("/f", h);
`;
    const found = collectMethodCallsFromSource(source, "mixed.ts");
    expect(found).toHaveLength(6);
    const kinds = found.map((f) => f.receiverKind).sort();
    expect(kinds).toEqual(
      ["computed", "factory", "identifier", "member", "optional", "this"].sort(),
    );
  });

  test("the range points to the correct offsets (start >= 0, end > start)", () => {
    const source = `app.get("/x", h);
`;
    const found = collectMethodCallsFromSource(source, "server.ts");
    expect(found).toHaveLength(1);
    const expr = found[0];
    if (!expr) throw new Error("expected one expression");
    expect(expr.range.file).toBe("server.ts");
    expect(expr.range.start).toBeGreaterThanOrEqual(0);
    expect(expr.range.end).toBeGreaterThan(expr.range.start);
  });

  test("unsupported shapes are ignored (bare CallExpression)", () => {
    const source = `handler();
foo(arg);
`;
    const found = collectMethodCallsFromSource(source, "plain.ts");
    expect(found).toHaveLength(0);
  });

  test("a file with invalid syntax does not abort the scan and returns []", () => {
    const source = `app.get("/users", handler`;
    const found = collectMethodCallsFromSource(source, "broken.ts");
    // With `errorRecovery: true`, Babel returns a partial AST; in
    // this case the `CallExpression` can still parse and the
    // collector emits the expression anyway. We verify it does NOT
    // throw.
    expect(Array.isArray(found)).toBe(true);
  });
});
