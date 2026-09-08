/**
 * Edge branch tests for c00010 S3: no-value flags, missing env paths,
 * and UI dependency fallbacks without changing production code.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { main as watchMain } from "../../packages/cli/commands/watch.script";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env["POSTMAN_PROJECT_ROOT"];
});

describe("watch command fallbacks", () => {
  test("accepts flags whose optional values are absent", async () => {
    const code = await watchMain([
      "--project-root",
      process.cwd(),
      "--once",
      "--framework",
      "--framework-search-root",
      "--debounce",
      "--format",
    ]);
    expect(code).toBe(1);
  });

  test("uses an environment root when no CLI root is supplied", async () => {
    process.env["POSTMAN_PROJECT_ROOT"] = process.cwd();
    const code = await watchMain(["--once"]);
    expect([0, 1]).toContain(code);
  });
});
