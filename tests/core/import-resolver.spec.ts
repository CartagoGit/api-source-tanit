import { describe, expect, test } from "vitest";

import { resolveImportPath } from "../../packages/core/discovery/import-resolver";

describe("resolveImportPath (r00014 S2)", () => {
  test("resolves ./foo against the importing file directory", () => {
    const candidates = resolveImportPath("/a/b/c.ts", "./foo", "/a");
    expect(candidates[0]?.path).toBe("/a/b/foo");
    expect(candidates[0]?.kind).toBe("literal");
  });

  test("resolves ../bar against the importing file directory", () => {
    const candidates = resolveImportPath("/a/b/c.ts", "../bar", "/a");
    expect(candidates[0]?.path).toBe("/a/bar");
  });

  test("offers extension and index fallbacks when the specifier has no extension", () => {
    const candidates = resolveImportPath("/a/b/c.ts", "./utils", "/a");
    const paths = candidates.map((candidate) => candidate.path);
    expect(paths).toContain("/a/b/utils.ts");
    expect(paths).toContain("/a/b/utils.js");
    expect(paths).toContain("/a/b/utils/index.ts");
  });

  test("empty specifier returns no candidates", () => {
    expect(resolveImportPath("/a/b/c.ts", "", "/a")).toEqual([]);
  });

  test("bare module specifiers are outside the resolver scope", () => {
    expect(resolveImportPath("/a/b/c.ts", "express", "/a")).toEqual([]);
  });
});