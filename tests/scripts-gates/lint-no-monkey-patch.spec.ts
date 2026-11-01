/**
 * Smoke test for `lint:no-monkey-patch` (c00010 S1).
 *
 * Spawns the gate as a child process and asserts it exits 0 against
 * the current tree (since the S1 refactor removed both monkey-patches
 * from `generate.script.ts`). When the gate is introduced, this test
 * must pass; a regression that re-introduces a `console.log =` or
 * `process.env.POSTMAN_* =` will flip the exit code and fail here.
 */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";

describe("lint:no-monkey-patch", () => {
  test("exits 0 on the current tree", () => {
    const result = spawnSync(
      "bun",
      ["run", "scripts/gates/lint-no-monkey-patch.script.ts"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/lint:no-monkey-patch — clean/);
  });
});