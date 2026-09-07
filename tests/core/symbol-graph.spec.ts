import { describe, expect, test } from "vitest";

import {
  SymbolGraph,
  type ISymbolNode,
} from "../../packages/core/discovery/symbol-graph";
import { makeSymbolId, symbolIdToString } from "../../packages/core/discovery/symbol-id";

function node(
  sourceFile: string,
  declarationStart: number,
  localName: string,
): ISymbolNode {
  return {
    id: makeSymbolId(sourceFile, declarationStart, localName),
    kind: "router",
  };
}

describe("SymbolGraph (r00014 S1)", () => {
  test("resolveByName only returns symbols declared in the requested file", () => {
    const builder = SymbolGraph.builder();
    const users = node("/proj/src/users.ts", 10, "router");
    const orders = node("/proj/src/orders.ts", 20, "router");
    builder.addSymbol(users);
    builder.addSymbol(orders);

    const graph = builder.finalize();
    expect(graph.resolveByName("/proj/src/users.ts", "router")).toEqual([users]);
    expect(graph.resolveByName("/proj/src/orders.ts", "router")).toEqual([orders]);
  });

  test("addSymbol is idempotent for the same SymbolId", () => {
    const builder = SymbolGraph.builder();
    const router = node("/proj/src/users.ts", 10, "router");
    builder.addSymbol(router);
    builder.addSymbol(router);

    const snapshot = builder.snapshot();
    expect(snapshot.nodes).toHaveLength(1);
    expect(symbolIdToString(snapshot.nodes[0]!.id)).toBe(symbolIdToString(router.id));
  });

  test("resolveByImportPath returns [] when the import edge is not registered", () => {
    const builder = SymbolGraph.builder();
    builder.addSymbol(node("/proj/src/users.ts", 10, "router"));

    const graph = builder.finalize();
    expect(graph.resolveByImportPath("/proj/src/server.ts", "./users", "usersRouter")).toEqual([]);
  });

  test("resolveByImportPath follows the local alias to the imported symbol name", () => {
    const builder = SymbolGraph.builder();
    const router = node("/proj/src/users.ts", 10, "router");
    builder.addSymbol(router);
    builder.addImport({
      sourceFile: "/proj/src/server.ts",
      specifier: "./users",
      localName: "usersRouter",
      importedName: "router",
    });

    const graph = builder.finalize();
    expect(graph.resolveByImportPath("/proj/src/server.ts", "./users", "usersRouter")).toEqual([router]);
  });
});