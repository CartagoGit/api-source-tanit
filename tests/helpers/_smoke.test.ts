/**
 * Smoke test del harness de tests. Si esto pasa, todo el setup
 * (bun:test, helpers, paths relativos) está OK.
 */
import { describe, expect, test } from "bun:test";
import { mkFixtureSync, rmFixtureSync } from "./fixtures";

describe("test harness — smoke", () => {
  test("mkFixtureSync crea archivos en tmpdir", () => {
    const root = mkFixtureSync({
      "package.json": `{"name": "fixture"}`,
      "src/index.ts": `console.log("hi")`,
    });
    expect(root).toStartWith("/tmp/");
    expect(Bun.file(`${root}/package.json`).size).toBeGreaterThan(0);
    expect(Bun.file(`${root}/src/index.ts`).size).toBeGreaterThan(0);
    rmFixtureSync(root);
  });

  test("bun:test describe + test + expect funcionan", () => {
    expect(1 + 1).toBe(2);
    expect("postman").toContain("postman");
    expect([1, 2, 3]).toHaveLength(3);
  });
});
