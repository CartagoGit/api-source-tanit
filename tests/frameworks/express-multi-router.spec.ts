/**
 * Express multi-router fixture test (audit 2026-09-06 §12,
 * proposal `r00014` S4).
 *
 * Pins the behaviour:
 *
 *   1. The scanner emits one route per `router.get(...)` (2
 *      routes total — one per file).
 *   2. The SymbolGraph carries **two distinct** ISymbolNodes
 *      for the same localName (`router`) — one per file.
 *      That is the infrastructure fix for the
 *      `x00055`-case where two same-named routers shared
 *      one slot and lost a prefix.
 *   3. `resolveByName(file, "router")` is file-scoped: it
 *      returns exactly the node from `file`, not the
 *      other one.
 */
import { describe, expect, test } from "vitest";
import { join } from "node:path";

import {
  ExpressProjectScanner,
  ExpressRouteScanner,
} from "../../packages/frameworks/scanners/express.scanner";

const FIXTURE = join("tests", "fixtures", "express-multi-router");

describe("express multi-router (r00014 S4)", () => {
  test("(1) emits one route per file", async () => {
    const match = await new ExpressProjectScanner().resolve(FIXTURE);
    const result = await new ExpressRouteScanner().scan(match);
    const routes = result.routes.filter((r) => r.uri === "/list");
    expect(routes).toHaveLength(2);
  });

  test("(2) SymbolGraph carries two distinct `router` nodes", async () => {
    const match = await new ExpressProjectScanner().resolve(FIXTURE);
    const result = await new ExpressRouteScanner().scan(match);
    const graph = result.symbols;
    expect(graph).toBeDefined();
    // Two `router` declarations, two sourceFiles.
    const all = graph?.nodes ?? [];
    const routerNodes = all.filter((n) => n.kind === "router");
    expect(routerNodes).toHaveLength(2);
    const files = new Set(routerNodes.map((n) => n.id.sourceFile));
    expect(files.size).toBe(2);
  });

  test("(3) resolveByName returns only the local file's node", async () => {
    const match = await new ExpressProjectScanner().resolve(FIXTURE);
    const result = await new ExpressRouteScanner().scan(match);
    const graph = result.symbols;
    expect(graph).toBeDefined();
    const files = [...new Set(graph!.nodes.map((n) => n.id.sourceFile))];
    expect(files).toHaveLength(2);
    for (const file of files) {
      const local = graph!.resolveByName(file, "router");
      expect(local).toHaveLength(1);
      expect(local[0]?.id.sourceFile).toBe(file);
    }
  });
});
