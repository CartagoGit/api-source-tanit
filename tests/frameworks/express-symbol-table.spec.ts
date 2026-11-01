/**
 * `x00055` S1 — Express per-file router SymbolTable.
 *
 * The original bug: two files each declaring `const router = Router()`
 * collided in the scanner's legacy `Map<routerName, prefix>` — the last
 * file parsed won, and one router inherited the other's `app.use` prefix.
 *
 * S1 does not fix the resolution yet (that is S2's `mountPrefixOf`);
 * it makes the scanner **record** the declarations without collapsing
 * them, so the data exists per file:
 *
 *   - `packages/frameworks/scanners/express-symbol-table.helper.ts` (the table)
 *   - `ExpressRouteScanner.scan()` populates `IScanResult.routerSymbols`
 *
 * Scope guard: these tests pin the table contract only — same-named
 * routers in different files stay distinct, prefixes travel, and
 * non-router declarations never enter the table.
 */
import { describe, expect, test } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  emptySymbolTable,
  freezeSymbolTable,
  populateFromModule,
  prefixOf,
  routerNamesInFile,
} from "../../packages/frameworks/scanners/express-symbol-table.helper";
import {
  ExpressProjectScanner,
  ExpressRouteScanner,
} from "../../packages/frameworks/scanners/express.scanner";
import type { IProjectMatch } from "../../packages/contracts/interfaces/core/scanner.interface";

// ---------------------------------------------------------------------------
// Table unit behaviour (pure, no fs)
// ---------------------------------------------------------------------------

describe("express.symbol-table (x00055 S1)", () => {
  test("two same-named routers in two files stay distinct rows", () => {
    const table = emptySymbolTable();
    populateFromModule(table, {
      file: "/proj/src/users/router.ts",
      declarations: [{ localName: "router", declarationStart: 42 }],
    });
    populateFromModule(table, {
      file: "/proj/src/admin/router.ts",
      declarations: [{ localName: "router", declarationStart: 7 }],
    });

    expect(routerNamesInFile(table, "/proj/src/users/router.ts")).toEqual([
      "router",
    ]);
    expect(routerNamesInFile(table, "/proj/src/admin/router.ts")).toEqual([
      "router",
    ]);
    // Each row keeps its own offset — the SymbolId anchor S2 will join on.
    expect(
      table.byFile.get("/proj/src/users/router.ts")?.get("router")
        ?.declarationStart,
    ).toBe(42);
    expect(
      table.byFile.get("/proj/src/admin/router.ts")?.get("router")
        ?.declarationStart,
    ).toBe(7);
  });

  test("prefixOf returns the declared prefix and undefined when absent", () => {
    const table = emptySymbolTable();
    populateFromModule(table, {
      file: "/proj/src/api.ts",
      declarations: [
        { localName: "apiRouter", prefix: "/api", declarationStart: 0 },
        { localName: "bareRouter", declarationStart: 100 },
      ],
    });
    expect(prefixOf(table, "/proj/src/api.ts", "apiRouter")).toBe("/api");
    // Declared without `{ prefix }` — distinguishable from unknown file/name.
    expect(prefixOf(table, "/proj/src/api.ts", "bareRouter")).toBeUndefined();
    // Unknown file / unknown name — undefined, never throws.
    expect(prefixOf(table, "/proj/src/other.ts", "apiRouter")).toBeUndefined();
    expect(prefixOf(table, "/proj/src/api.ts", "nope")).toBeUndefined();
  });

  test("re-registering the same (file, name) replaces instead of duplicating", () => {
    const table = emptySymbolTable();
    populateFromModule(table, {
      file: "/proj/src/r.ts",
      declarations: [{ localName: "router", prefix: "/a", declarationStart: 1 }],
    });
    populateFromModule(table, {
      file: "/proj/src/r.ts",
      declarations: [{ localName: "router", prefix: "/b", declarationStart: 1 }],
    });
    expect(routerNamesInFile(table, "/proj/src/r.ts")).toEqual(["router"]);
    expect(prefixOf(table, "/proj/src/r.ts", "router")).toBe("/b");
  });

  test("freezeSymbolTable returns a frozen structure with the same data", () => {
    const table = emptySymbolTable();
    populateFromModule(table, {
      file: "/f.ts",
      declarations: [{ localName: "r", prefix: "/p", declarationStart: 3 }],
    });
    const frozen = freezeSymbolTable(table);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(prefixOf(frozen, "/f.ts", "r")).toBe("/p");
  });
});

// ---------------------------------------------------------------------------
// Scanner integration: scan() populates routerSymbols
// ---------------------------------------------------------------------------

async function makeExpressProject(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tanit-x00055-s1-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "x00055-fixture",
      dependencies: { express: "^4.0.0" },
    }),
  );
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return root;
}

function matchFor(root: string): IProjectMatch {
  return {
    framework: "express",
    projectRoot: root,
    artifacts: ["package.json"],
  };
}

describe("ExpressRouteScanner.routerSymbols (x00055 S1)", () => {
  test("two files declaring the same router name produce two distinct rows", async () => {
    const root = await makeExpressProject({
      "src/users/router.ts": `import { Router } from "express";
const router = Router();
router.get("/users", (_req, res) => res.json([]));
export default router;
`,
      "src/admin/router.ts": `import { Router } from "express";
const router = Router();
router.get("/admin", (_req, res) => res.json({ ok: true }));
export default router;
`,
      "src/server.ts": `import express from "express";
import usersRouter from "./users/router";
import adminRouter from "./admin/router";
const app = express();
app.use("/users", usersRouter);
app.use("/admin", adminRouter);
`,
    });
    try {
      const scanner = new ExpressRouteScanner();
      const result = await scanner.scan(matchFor(root));
      const table = result.routerSymbols;
      expect(table).toBeDefined();
      const files = [...(table?.byFile.keys() ?? [])];
      const usersFile = files.find((f) => f.includes("users"));
      const adminFile = files.find((f) => f.includes("admin"));
      expect(usersFile).toBeDefined();
      expect(adminFile).toBeDefined();
      // THE bug pin: same localName, different files — both present.
      expect(routerNamesInFile(table!, usersFile!)).toEqual(["router"]);
      expect(routerNamesInFile(table!, adminFile!)).toEqual(["router"]);
      // Anchors are (file, offset) pairs: two files may legitimately
      // carry the same byte offset (identical layout), and they are
      // still distinct rows because the FILE differs.
      expect(usersFile).not.toBe(adminFile);
      const usersOffset = table?.byFile.get(usersFile!)?.get("router")
        ?.declarationStart;
      const adminOffset = table?.byFile.get(adminFile!)?.get("router")
        ?.declarationStart;
      expect(usersOffset).toBeDefined();
      expect(adminOffset).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("declarations with { prefix } carry the prefix into the table", async () => {
    const root = await makeExpressProject({
      "src/routes.ts": `import { Router } from "express";
const api = Router({ prefix: "/api/v1" });
api.get("/ping", (_req, res) => res.send("pong"));
export default api;
`,
    });
    try {
      const scanner = new ExpressRouteScanner();
      const result = await scanner.scan(matchFor(root));
      const table = result.routerSymbols;
      const file = [...(table?.byFile.keys() ?? [])].find((f) =>
        f.includes("routes.ts"),
      );
      expect(file).toBeDefined();
      expect(prefixOf(table!, file!, "api")).toBe("/api/v1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("non-router constants never enter the table", async () => {
    const root = await makeExpressProject({
      "src/data.ts": `const config = { prefix: "/not-a-router" };
const handler = (_req: unknown, res: unknown) => res;
export { config, handler };
`,
      "src/app.ts": `import express from "express";
const app = express();
app.get("/health", (_req, res) => res.json({ ok: true }));
`,
    });
    try {
      const scanner = new ExpressRouteScanner();
      const result = await scanner.scan(matchFor(root));
      const table = result.routerSymbols ?? emptySymbolTable();
      for (const [file, bucket] of table.byFile) {
        expect(bucket.has("config"), `config leaked into ${file}`).toBe(false);
        expect(bucket.has("app"), `app leaked into ${file}`).toBe(false);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("detector contract is untouched (x00055 S1 is additive)", async () => {
    const root = await makeExpressProject({});
    try {
      const detector = new ExpressProjectScanner();
      const detected = await detector.detect(root);
      expect(detected.score).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
