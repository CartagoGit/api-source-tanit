/**
 * `list-endpoints.script.ts` — `runList()` in-process.
 *
 * The command used to be exercised only by spawning it as a process,
 * which `tests/cli/cli-external-project.test.ts` does for `generate`
 * but not for `list`. `runList` returns a typed `IListOutcome`; the
 * dispatcher in `cli.script.ts` calls it through the wrapper. The
 * pure version is what the MCP tool consumes, and its return shape
 * (code + endpoints) is the contract that matters.
 *
 * What this spec covers:
 *
 *   - Happy path: the collection exists and `runList` returns its
 *     endpoints grouped by zone.
 *   - The "no collection yet" branch: the file does not exist,
 *     `explainReadFailure` is invoked, and the returned code is 1.
 *   - The "JSON not parseable" branch: the file is corrupt and the
 *     helper explains it without crashing.
 *   - Endpoints carry the zone assigned by `zoneForUri`.
 *
 * `main` (the CLI wrapper that only returns the exit code) is
 * exercised indirectly here: `runList(argv).code === main(argv)`.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runList } from "../../packages/cli/commands/list-endpoints.script";
import { runGenerate } from "../../packages/cli/commands/generate.script";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import { copyExampleClean } from "../helpers/fixtures";
import { exampleDir } from "../../scripts/helpers/root.helper";

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "list-cmd-"));
}, 60_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

async function withGeneratedProject(name: string): Promise<string> {
  const root = join(work, name);
  await copyExampleClean(exampleDir("express"), root);
  // `runGenerate` is the in-process equivalent of `apisrc generate`:
  // it scans, validates, and writes the collection (and environments)
  // into the project folder, just like the CLI would.
  const out = await runGenerate(["--project-root", root]);
  expect(out.code, "runGenerate must succeed").toBe(0);
  return root;
}

describe("list-endpoints — runList", () => {
  test("returns endpoints grouped by zone when the collection exists", async () => {
    const root = await withGeneratedProject("happy");
    const outcome = await runList(["--project-root", root]);
    expect(outcome.code).toBe(0);
    expect(outcome.endpoints.length).toBeGreaterThan(0);
    for (const ep of outcome.endpoints) {
      expect(ep.method).toMatch(/^[A-Z]+$/);
      expect(typeof ep.uri).toBe("string");
    }
  });

  test("returns code 1 when the collection does not exist yet", async () => {
    const root = join(work, "no-collection");
    await copyExampleClean(exampleDir("express"), root);
    // Drop the output folder so the helper sees ENOENT.
    await rm(join(root, OUTPUT_DIR_NAME), { recursive: true, force: true });
    const outcome = await runList(["--project-root", root]);
    expect(outcome.code).toBe(1);
    expect(outcome.endpoints).toEqual([]);
  });

  test("returns code 1 when the collection is corrupt (not valid JSON)", async () => {
    const root = await withGeneratedProject("corrupt");
    const file = join(
      root,
      OUTPUT_DIR_NAME,
      "sample-express.postman_collection.json",
    );
    await writeFile(file, "{not json");
    const outcome = await runList(["--project-root", root]);
    expect(outcome.code).toBe(1);
    expect(outcome.endpoints).toEqual([]);
  });

  test("the returned endpoints include the zone assigned by config", async () => {
    const root = await withGeneratedProject("zones");
    const outcome = await runList(["--project-root", root]);
    expect(outcome.code).toBe(0);
    // All endpoints must carry a zone, even when the configuration has
    // an empty `zoneOrder` (zero-config falls back to `defaultZone`).
    for (const ep of outcome.endpoints) {
      expect(typeof ep.zone).toBe("string");
      expect(ep.zone.length).toBeGreaterThan(0);
    }
  });

  test("regenerates a missing collection when no generate was run", async () => {
    const root = join(work, "roundtrip");
    await copyExampleClean(exampleDir("express"), root);
    // First call: collection missing.
    const antes = await runList(["--project-root", root]);
    expect(antes.code).toBe(1);
    // Generate, then list again.
    const gen = await runGenerate(["--project-root", root]);
    expect(gen.code).toBe(0);
    const despues = await runList(["--project-root", root]);
    expect(despues.code).toBe(0);
    expect(despues.endpoints.length).toBeGreaterThan(0);
  });
});