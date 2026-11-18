/**
 * `resolveImportPath` tests (audit 2026-09-06 §12, proposal
 * `r00014` S2).
 *
 * Covers the four acceptance bullets the proposal lists:
 *
 *   - `./foo` desde `/a/b/c.ts` → contiene `/a/b/foo.ts`.
 *   - `../bar` desde `/a/b/c.ts` → contiene `/a/bar.ts`.
 *   - `./utils` (sin ext) → devuelve `/a/b/utils.ts` (preferido),
 *     `.tsx`, `.js`, `/index.ts`, `/index.js`.
 *   - Empty path → devuelve `[]` (no throw).
 *
 * Plus the path-resolution bare-module behaviour: since `r00020`
 * S1 the resolver owns `node_modules`, so `import "express"`
 * returns the chain of paths where the package would live.
 */
import { describe, expect, test } from "vitest";

import {
  resolveImportPath,
  type IImportCandidate,
} from "../../../packages/core/discovery/import-resolver";

const ROOT = "/proj";

function paths(candidates: ReadonlyArray<IImportCandidate>): string[] {
  return candidates.map((c) => c.path);
}

describe("resolveImportPath (r00014 S2)", () => {
  test("./foo from /a/b/c.ts normalises to /a/b/foo (+ fallbacks)", () => {
    const result = resolveImportPath("/proj/a/b/c.ts", "./foo", ROOT);
    const p = paths(result);
    // The literal (first candidate) keeps the specifier
    // verbatim — no filesystem I/O is performed here.
    expect(p[0]).toBe("/proj/a/b/foo");
    // Fallback chain produces `.ts`, `.tsx`, `.js`, and
    // directory-index variants.
    expect(p).toContain("/proj/a/b/foo.ts");
    expect(p).toContain("/proj/a/b/foo.tsx");
    expect(p).toContain("/proj/a/b/foo.js");
    expect(p).toContain("/proj/a/b/foo/index.ts");
  });

  test("../bar from /a/b/c.ts climbs one level", () => {
    const result = resolveImportPath("/proj/a/b/c.ts", "../bar", ROOT);
    const p = paths(result);
    expect(p[0]).toBe("/proj/a/bar");
    expect(p).toContain("/proj/a/bar.ts");
  });

  test("./utils (no ext) returns the literal + extension fallback chain", () => {
    const result = resolveImportPath("/proj/a/b/c.ts", "./utils", ROOT);
    const p = paths(result);
    expect(p[0]).toBe("/proj/a/b/utils");
    expect(p).toContain("/proj/a/b/utils.ts");
    expect(p).toContain("/proj/a/b/utils.tsx");
    expect(p).toContain("/proj/a/b/utils.js");
    expect(p).toContain("/proj/a/b/utils/index.ts");
    expect(p).toContain("/proj/a/b/utils/index.js");
  });

  test("empty path returns [] (does NOT throw)", () => {
    const result = resolveImportPath("/proj/a/b/c.ts", "", ROOT);
    expect(result).toEqual([]);
  });

  test("bare module specifier (no leading . or /) resolves to node_modules", () => {
    // r00020 S1: the resolver owns `node_modules` now. The
    // candidates are the paths where the package would live, in
    // probe order — the nearest `node_modules` first.
    const result = resolveImportPath("/proj/a/b/c.ts", "express", ROOT);
    expect(result.length).toBeGreaterThan(0);
    const paths = result.map((candidate) => candidate.path);
    expect(paths[0]).toBe("/proj/a/b/node_modules/express");
    expect(paths).toContain("/proj/node_modules/express/index.js");
    expect(result.some((candidate) => candidate.kind === "node-modules")).toBe(
      true,
    );
  });

  test("absolute path inside the project is returned verbatim with fallback chain", () => {
    const result = resolveImportPath(
      "/proj/a/b/c.ts",
      "/proj/a/b/util.ts",
      ROOT,
    );
    expect(paths(result)[0]).toBe("/proj/a/b/util.ts");
    expect(result).toContainEqual({
      path: "/proj/a/b/util/index.ts",
      kind: "index-fallback",
    });
  });

  test("never throws on garbage input", () => {
    expect(() =>
      resolveImportPath("/proj/a/b/c.ts", "...", ROOT),
    ).not.toThrow();
    expect(() =>
      resolveImportPath("", "./foo", ROOT),
    ).not.toThrow();
    expect(() => resolveImportPath("/proj/a.ts", ".../", ROOT)).not.toThrow();
  });

  test("preserves a tsconfig alias-free project: import from cwd sibling", () => {
    const result = resolveImportPath("/proj/a/b/c.ts", "../shared/db", ROOT);
    const p = paths(result);
    expect(p[0]).toBe("/proj/a/shared/db");
    expect(p).toContain("/proj/a/shared/db.ts");
  });
});
