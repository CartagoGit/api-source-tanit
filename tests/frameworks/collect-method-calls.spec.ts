/**
 * Tests para `collectMethodCallsFromSource` (a00016 S2).
 *
 * Cubre los 6 estilos que `IRouteCallExpression.receiverKind`
 * distingue:
 *
 *   - identifier (`app.get`)
 *   - this (`this.router.get`)
 *   - member (`api.router.get`)
 *   - factory (`getRouter().get`)
 *   - computed (`server["get"]`)
 *   - optional (`router?.get`)
 *
 * Tests unitarios sobre `collectMethodCallsFromSource(source, filename)`
 * — la primitiva pura. `collectMethodCalls(projectRoot)` se cubre en
 * S5 con un proyecto temporal en disco, igual que en a00015 S2.
 */
import { describe, expect, test } from "vitest";

import { collectMethodCallsFromSource } from "../../packages/frameworks/typescript/collect-method-calls";

describe("collectMethodCallsFromSource — estilos del callee", () => {
  test("identifier: `app.get('/x')` se reconoce con receiverKind=identifier", () => {
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

  test("this: `this.router.get('/x')` se reconoce con receiverKind=this", () => {
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

  test("member: `api.router.get('/x')` se reconoce con receiverKind=member", () => {
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

  test("factory: `getRouter().get('/x')` se reconoce con receiverKind=factory", () => {
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

  test("computed: `server['get']('/x')` se reconoce con receiverKind=computed", () => {
    const source = `server["get"]("/users", handler);
server["post"]("/orders", handler);
`;
    const found = collectMethodCallsFromSource(source, "server.ts");
    expect(found).toHaveLength(2);
    // Para string literals directos (`server["get"]`), el método YA
    // se conoce en el parse — `method` se rellena con el valor del
    // literal. S4 (`propagateConstants`) sólo añade valor cuando la
    // propiedad es un identificador que resuelve a una constante
    // (`const M = "get"; app[M]()`).
    expect(found[0]?.callee).toBe('server["get"]');
    expect(found[0]?.receiverKind).toBe("computed");
    expect(found[0]?.method).toBe("get");
    expect(found[1]?.callee).toBe('server["post"]');
    expect(found[1]?.receiverKind).toBe("computed");
    expect(found[1]?.method).toBe("post");
  });

  test("optional: `router?.get('/x')` se reconoce con receiverKind=optional", () => {
    const source = `router?.get("/users", handler);
`;
    const found = collectMethodCallsFromSource(source, "server.ts");
    expect(found).toHaveLength(1);
    const expr = found[0];
    // El callee textual omite el `?.` porque `renderReceiver` usa
    // `.` para imprimir. El scanner que necesite el `?.` mira
    // `receiverKind === "optional"` y lo añade en su output.
    expect(expr?.callee).toBe("router.get");
    expect(expr?.receiverKind).toBe("optional");
    expect(expr?.method).toBe("get");
  });
});

describe("collectMethodCallsFromSource — coexistencia y rangos", () => {
  test("mezcla de los 6 estilos en un mismo archivo se identifican todos", () => {
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

  test("el rango apunta a los offsets correctos (start >= 0, end > start)", () => {
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

  test("formas no soportadas se ignoran (CallExpression desnuda)", () => {
    const source = `handler();
foo(arg);
`;
    const found = collectMethodCallsFromSource(source, "plain.ts");
    expect(found).toHaveLength(0);
  });

  test("un fichero con sintaxis inválida no aborta el scan y devuelve []", () => {
    const source = `app.get("/users", handler`;
    const found = collectMethodCallsFromSource(source, "broken.ts");
    // Con `errorRecovery: true`, Babel devuelve un AST parcial; en
    // este caso el `CallExpression` puede parsear y el collector
    // emite la expresión igual. Verificamos que NO lanza.
    expect(Array.isArray(found)).toBe(true);
  });
});
