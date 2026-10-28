/**
 * `SymbolGraph` + `SymbolId` tests (audit 2026-09-06 §12,
 * proposal `r00014` S1).
 *
 * Pins the four invariants the proposal calls out for S1:
 *
 *   1. 2 symbols con mismo `localName` en ficheros distintos →
 *      `resolveByName` devuelve sólo el del fichero pedido.
 *   2. addSymbol idempotente (mismo `SymbolId` dos veces no
 *      duplica el node).
 *   3. resolveByImportPath con import no registrado → array
 *      vacío (no throw).
 *   4. `SymbolId` serialisation round-trip.
 *
 * Plus the `makeSymbolId` invariant checks (non-empty fields,
 * non-negative offset) so misuse is caught at construction
 * time, not at consumer time.
 */
import { describe, expect, test } from "vitest";

import {
  makeSymbolId,
  parseSymbolId,
  symbolIdToString,
} from "../../../packages/core/discovery/symbol-id";
import {
  SymbolGraphBuilder,
  empty,
} from "../../../packages/core/discovery/symbol-graph";

describe("SymbolId — invariants", () => {
  test("rejects empty sourceFile", () => {
    expect(() => makeSymbolId("", 0, "x")).toThrow(/sourceFile/);
  });

  test("rejects negative offset", () => {
    expect(() => makeSymbolId("/a.ts", -1, "x")).toThrow(/declarationStart/);
  });

  test("rejects non-finite offset", () => {
    expect(() => makeSymbolId("/a.ts", Number.NaN, "x")).toThrow(
      /declarationStart/,
    );
  });

  test("rejects empty localName", () => {
    expect(() => makeSymbolId("/a.ts", 0, "")).toThrow(/localName/);
  });

  test("serialise ↔ parse round-trip", () => {
    const id = makeSymbolId("/a/b.ts", 123, "router");
    const parsed = parseSymbolId(symbolIdToString(id));
    expect(parsed).toEqual(id);
  });

  test("parseSymbolId returns null on garbage", () => {
    expect(parseSymbolId("not a symbol id")).toBeNull();
    expect(parseSymbolId("")).toBeNull();
    expect(parseSymbolId(":offset:name")).toBeNull();
  });
});

describe("SymbolGraph — build + resolve", () => {
  test("resolveByName is file-scoped", () => {
    const b = new SymbolGraphBuilder();
    const idA = makeSymbolId("/a/routes.ts", 12, "router");
    const idB = makeSymbolId("/b/routes.ts", 34, "router");
    b.addSymbol({ id: idA, kind: "router", payload: "/users" });
    b.addSymbol({ id: idB, kind: "router", payload: "/orders" });
    const g = b.finalize();

    expect(g.resolveByName("/a/routes.ts", "router")).toEqual([
      { id: idA, kind: "router", payload: "/users" },
    ]);
    expect(g.resolveByName("/b/routes.ts", "router")).toEqual([
      { id: idB, kind: "router", payload: "/orders" },
    ]);
  });

  test("addSymbol is idempotent", () => {
    const b = new SymbolGraphBuilder();
    const id = makeSymbolId("/a.ts", 0, "router");
    b.addSymbol({ id, kind: "router", payload: "/x" });
    b.addSymbol({ id, kind: "router", payload: "/y" }); // duplicate
    const g = b.finalize();
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]?.payload).toBe("/x");
  });

  test("resolveByImportPath returns [] for unknown import", () => {
    const b = new SymbolGraphBuilder();
    b.addSymbol({
      id: makeSymbolId("/a.ts", 0, "router"),
      kind: "router",
    });
    const g = b.finalize();
    expect(g.resolveByImportPath("/server.ts", "./a", "router")).toEqual([]);
  });

  test("resolveByImportPath follows an import edge to the target file", () => {
    const b = new SymbolGraphBuilder();
    b.addSymbol({
      id: makeSymbolId("/users/routes.ts", 0, "router"),
      kind: "router",
      payload: "/users",
    });
    b.addImport({
      sourceFile: "/server.ts",
      specifier: "./users/routes",
      localName: "usersRouter",
      importedName: "router",
    });
    const g = b.finalize();
    const nodes = g.resolveByImportPath(
      "/server.ts",
      "./users/routes",
      "usersRouter",
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.payload).toBe("/users");
  });

  test("empty() returns a frozen graph with no nodes", () => {
    const g = empty();
    expect(g.nodes).toEqual([]);
    expect(g.imports).toEqual([]);
    expect(g.resolveByName("/nope", "router")).toEqual([]);
  });

  test("snapshot() exposes the un-frozen state for tests", () => {
    const b = new SymbolGraphBuilder();
    b.addSymbol({
      id: makeSymbolId("/a.ts", 0, "x"),
      kind: "value",
    });
    const snap = b.snapshot();
    expect(snap.nodes).toHaveLength(1);
  });
});
