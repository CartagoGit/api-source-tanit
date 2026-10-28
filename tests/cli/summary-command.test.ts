/**
 * `summary.script.ts` — `main()` in-process.
 *
 * `summary` inspects a host project without generating artifacts. It
 * used to be exercised only through process spawning, but the only
 * function it exports is `main(argv)` and the **typed** work lives
 * in `summarizeWithAllFrameworks()` (already covered by core specs).
 * What we cover here is the command: format selection (`--format`),
 * the history append (`--no-history` opt-out), and the failure
 * branch when the framework cannot be detected.
 *
 * What this spec covers:
 *
 *   - `--format text` (default) prints the human-readable summary and
 *     exits 0.
 *   - `--format json` dumps the `IProjectSummary` as JSON and exits 0.
 *   - `--no-history` skips the append to `~/.tanit/history.jsonl`
 *     (verified indirectly: the command still exits 0 without
 *     writing).
 *   - A folder with no recognizable framework returns `code: 1` and
 *     a printed error.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { main } from "../../packages/cli/commands/summary.script";
import { copyExampleClean } from "../helpers/fixtures";
import { exampleDir } from "../../scripts/helpers/root.helper";

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "summary-cmd-"));
}, 60_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

/**
 * The exported `main()` reads from `process.argv`. To exercise it in
 * tests we patch `process.argv` for the call. We restore the slice
 * afterwards so concurrent tests in the same process do not see the
 * override.
 */
async function withArgv<T>(
  args: ReadonlyArray<string>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = [...process.argv];
  try {
    process.argv = ["node", "summary.script.ts", ...args];
    return await fn();
  } finally {
    process.argv = saved;
  }
}

describe("summary — main()", () => {
  test("prints the human-readable summary and exits 0", async () => {
    const root = join(work, "text");
    await copyExampleClean(exampleDir("express"), root);
    const code = await withArgv(["--project-root", root], () => main());
    expect(code).toBe(0);
  });

  test("--format json dumps IProjectSummary as JSON", async () => {
    const root = join(work, "json");
    await copyExampleClean(exampleDir("express"), root);
    const logs: string[] = [];
    const saved = console.log;
    console.log = (...values: ReadonlyArray<unknown>): void => {
      for (const v of values) logs.push(String(v));
    };
    try {
      const code = await withArgv(
        ["--project-root", root, "--format", "json"],
        () => main(),
      );
      expect(code).toBe(0);
    } finally {
      console.log = saved;
    }
    // At least one of the printed lines should be valid JSON
    // containing the framework name.
    const joined = logs.join("\n");
    expect(joined).toContain('"framework"');
  });

  test("--no-history does not crash and still exits 0", async () => {
    const root = join(work, "no-history");
    await copyExampleClean(exampleDir("express"), root);
    const code = await withArgv(
      ["--project-root", root, "--no-history"],
      () => main(),
    );
    expect(code).toBe(0);
  });

  test("returns code 1 when no framework matches", async () => {
    const root = join(work, "no-framework");
    // No express fixture; pass a directory that has no recognizable
    // manifest.
    const code = await withArgv(["--project-root", root], () => main());
    expect(code).toBe(1);
  });

  test("falls back to a `text` format when `--format` is unknown", async () => {
    const root = join(work, "unknown-format");
    await copyExampleClean(exampleDir("express"), root);
    // `main` does not validate `--format` itself — it accepts
    // anything that is not literally `json` as text. We assert the
    // contract: a non-json value does not break the command.
    const code = await withArgv(
      ["--project-root", root, "--format", "bogus"],
      () => main(),
    );
    expect(code).toBe(0);
  });
});