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
    // The fixture produces 4 router-kind nodes: 2 mount sites
    // (`server.ts`: `app.use('/api/users', usersRouter)` +
    // `app.use('/api/orders', ordersRouter)`) and 2 declaration
    // sites (`users.ts` + `orders.ts`, both `const router =
    // express.Router()`). The x00055 pin is that the two
    // DECLARATIONS are distinct nodes in distinct files — the
    // legacy Map collapsed them into one slot.
    const all = graph?.nodes ?? [];
    const routerNodes = all.filter((n) => n.kind === "router");
    expect(routerNodes).toHaveLength(4);
    const declarationNodes = routerNodes.filter((n) =>
      n.id.sourceFile.endsWith("users.ts") ||
      n.id.sourceFile.endsWith("orders.ts"),
    );
    expect(declarationNodes).toHaveLength(2);
    const declarationFiles = new Set(
      declarationNodes.map((n) => n.id.sourceFile),
    );
    expect(declarationFiles.size).toBe(2);
  });

  test("(3) resolveByName returns only the local file's node", async () => {
    const match = await new ExpressProjectScanner().resolve(FIXTURE);
    const result = await new ExpressRouteScanner().scan(match);
    const graph = result.symbols;
    expect(graph).toBeDefined();
    // server.ts holds the 2 mount nodes; users.ts / orders.ts hold
    // one `router` declaration each. resolveByName is file-scoped:
    // asking for "router" in server.ts returns [] (its routers are
    // mounts named usersRouter/ordersRouter), and asking in each
    // router file returns exactly its own node.
    const files = [...new Set(graph!.nodes.map((n) => n.id.sourceFile))];
    expect(files).toHaveLength(3);
    for (const file of files) {
      const local = graph!.resolveByName(file, "router");
      if (file.endsWith("server.ts")) {
        expect(local).toHaveLength(0);
        continue;
      }
      expect(local).toHaveLength(1);
      expect(local[0]?.id.sourceFile).toBe(file);
    }
  });
});
