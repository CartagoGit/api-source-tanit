/**
 * x00063 — `IImportRecord.targetFile` and `targetSymbol` narrow the
 * `SymbolGraph.resolveByImportPath()` lookup. Before this slice, the
 * resolver did a global search across every file by `importedName`,
 * which meant two routers named `router` in two files both
 * returned (audit 2026-09-06 §4 P1).
 *
 * The fix has two layers:
 *
 * 1. `targetSymbol` (preferred): exact SymbolId lookup, no search.
 * 2. `targetFile`: narrowed search, only the resolved file.
 * 3. Neither set: legacy fallback (the old behaviour). Kept for
 *    `node_modules` resolution and similar unresolvable cases.
 */
import { describe, expect, test } from "vitest";
import { SymbolGraph } from "../../packages/core/discovery/symbol-graph";
import type { ISymbolNode, SymbolKind } from "../../packages/core/discovery/symbol-graph";
import { makeSymbolId } from "../../packages/core/discovery/symbol-id";

function node(
  sourceFile: string,
  start: number,
  localName: string,
  kind: SymbolKind = "value",
): ISymbolNode {
  return {
    id: makeSymbolId(sourceFile, start, localName),
    kind,
  };
}

describe("x00063 — SymbolGraph resolved import edges", () => {
  test("(1) targetSymbol pins the lookup: no global search", () => {
    const g = SymbolGraph.builder();
    // Two routers with the same localName "router" in two files.
    const usersNode = node("/proj/users.ts", 100, "router", "router");
    const adminNode = node("/proj/admin.ts", 100, "router", "router");
    g.addSymbol(usersNode);
    g.addSymbol(adminNode);
    // Import `router` from "./users"; resolved target is usersNode.
    g.addImport({
      sourceFile: "/proj/app.ts",
      specifier: "./users",
      localName: "router",
      importedName: "router",
      targetSymbol: usersNode.id,
    });
    const found = g.finalize().resolveByImportPath(
      "/proj/app.ts",
      "./users",
      "router",
    );
    // Exactly one match: the users node, NOT the admin one.
    expect(found).toHaveLength(1);
    expect(found[0]?.id.sourceFile).toBe("/proj/users.ts");
  });

  test("(2) targetFile narrows the search to one file", () => {
    const g = SymbolGraph.builder();
    const usersNode = node("/proj/users.ts", 100, "router", "router");
    const adminNode = node("/proj/admin.ts", 100, "router", "router");
    g.addSymbol(usersNode);
    g.addSymbol(adminNode);
    g.addImport({
      sourceFile: "/proj/app.ts",
      specifier: "./users",
      localName: "router",
      importedName: "router",
      targetFile: "/proj/users.ts",
    });
    const found = g.finalize().resolveByImportPath(
      "/proj/app.ts",
      "./users",
      "router",
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.id.sourceFile).toBe("/proj/users.ts");
  });

  test("(3) neither targetFile nor targetSymbol: legacy global-name search", () => {
    // Legacy callers (without resolver integration) keep the
    // previous behaviour: search every other file by importedName.
    // The audit explicitly flags this as the "footgun"; new callers
    // should populate targetFile/targetSymbol.
    const g = SymbolGraph.builder();
    const usersNode = node("/proj/users.ts", 100, "router");
    const adminNode = node("/proj/admin.ts", 100, "router");
    g.addSymbol(usersNode);
    g.addSymbol(adminNode);
    g.addImport({
      sourceFile: "/proj/app.ts",
      specifier: "./users",
      localName: "router",
      importedName: "router",
    });
    const found = g.finalize().resolveByImportPath(
      "/proj/app.ts",
      "./users",
      "router",
    );
    // Both match — that's the documented footgun.
    expect(found).toHaveLength(2);
  });

  test("(4) targetSymbol with a misspelled id returns empty", () => {
    const g = SymbolGraph.builder();
    const usersNode = node("/proj/users.ts", 100, "router");
    g.addSymbol(usersNode);
    g.addImport({
      sourceFile: "/proj/app.ts",
      specifier: "./users",
      localName: "router",
      importedName: "router",
      targetSymbol: makeSymbolId("/proj/users.ts", 9999, "router"),
    });
    const found = g.finalize().resolveByImportPath(
      "/proj/app.ts",
      "./users",
      "router",
    );
    expect(found).toHaveLength(0);
  });

  test("(5) targetFile points at a file with no matching node → empty", () => {
    const g = SymbolGraph.builder();
    const usersNode = node("/proj/users.ts", 100, "router");
    g.addSymbol(usersNode);
    g.addImport({
      sourceFile: "/proj/app.ts",
      specifier: "./users",
      localName: "router",
      importedName: "router",
      targetFile: "/proj/elsewhere.ts",
    });
    const found = g.finalize().resolveByImportPath(
      "/proj/app.ts",
      "./users",
      "router",
    );
    expect(found).toHaveLength(0);
  });
});