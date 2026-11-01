/**
 * Smoke test for the test harness. If this passes, the whole setup
 * (vitest, helpers, relative paths) is OK.
 */
import { describe, expect, test } from "vitest";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkFixtureSync, rmFixtureSync } from "../helpers/fixtures";

describe("test harness — smoke", () => {
  test("mkFixtureSync writes files into tmpdir", () => {
    const root = mkFixtureSync({
      "package.json": `{"name": "fixture"}`,
      "src/index.ts": `console.log("hi")`,
    });
    expect(root.startsWith(tmpdir())).toBe(true);
    expect(statSync(join(root, "package.json")).size).toBeGreaterThan(0);
    expect(statSync(join(root, "src/index.ts")).size).toBeGreaterThan(0);
    rmFixtureSync(root);
  });

  test("describe + test + expect work", () => {
    expect(1 + 1).toBe(2);
    expect("postman").toContain("postman");
    expect([1, 2, 3]).toHaveLength(3);
  });
});
