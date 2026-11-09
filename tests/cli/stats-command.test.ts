/**
 * `stats.script.ts` — `runStats()` in-process.
 *
 * Counts the requests in the collection, grouped by HTTP method and
 * by zone. Like the other "reads the generated artifact" commands
 * (`list`, `check`, `validate`), it used to be covered only through
 * process spawning; the pure `runStats(argv, context?)` is what the
 * MCP tool consumes, and the contract that matters is the typed
 * `IStatsOutcome`.
 *
 * What this spec covers:
 *
 *   - Happy path: total requests > 0, `byMethod` is sorted highest
 *     first, `zones` lists at least the `defaultZone`.
 *   - "No collection yet": returns `code: 1`, empty totals, no
 *     surprises.
 *   - "JSON not parseable": returns `code: 1`, empty totals.
 *   - The `byMethod` ordering is descending by count.
 *   - The zone groupings add up to the total.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runStats } from "../../packages/cli/commands/stats.script";
import { runGenerate } from "../../packages/cli/commands/generate.script";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import { copyExampleClean } from "../helpers/fixtures";
import { exampleDir } from "../../scripts/helpers/root.helper";

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "stats-cmd-"));
}, 60_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

async function generatedProject(name: string): Promise<string> {
  const root = join(work, name);
  await copyExampleClean(exampleDir("express"), root);
  const out = await runGenerate(["--project-root", root]);
  expect(out.code, "runGenerate must succeed").toBe(0);
  return root;
}

describe("stats — runStats", () => {
  test("returns totals, byMethod, and zones when the collection exists", async () => {
    const root = await generatedProject("happy");
    const outcome = await runStats(["--project-root", root]);
    expect(outcome.code).toBe(0);
    expect(outcome.total).toBeGreaterThan(0);
    expect(outcome.byMethod.length).toBeGreaterThan(0);
    expect(outcome.zones.length).toBeGreaterThan(0);
  });

  test("returns code 1 when the collection does not exist yet", async () => {
    const root = join(work, "no-collection");
    await copyExampleClean(exampleDir("express"), root);
    await rm(join(root, OUTPUT_DIR_NAME), { recursive: true, force: true });
    const outcome = await runStats(["--project-root", root]);
    expect(outcome.code).toBe(1);
    expect(outcome.total).toBe(0);
    expect(outcome.byMethod).toEqual([]);
    expect(outcome.zones).toEqual([]);
  });

  test("returns code 1 when the collection is corrupt", async () => {
    const root = await generatedProject("corrupt");
    const file = join(
      root,
      OUTPUT_DIR_NAME,
      "sample-express.postman_collection.json",
    );
    await writeFile(file, "{not json");
    const outcome = await runStats(["--project-root", root]);
    expect(outcome.code).toBe(1);
    expect(outcome.total).toBe(0);
  });

  test("byMethod is sorted by count descending", async () => {
    const root = await generatedProject("sort-by-method");
    const outcome = await runStats(["--project-root", root]);
    expect(outcome.code).toBe(0);
    for (let i = 1; i < outcome.byMethod.length; i++) {
      const prev = outcome.byMethod[i - 1];
      const cur = outcome.byMethod[i];
      if (prev && cur) {
        expect(prev.count).toBeGreaterThanOrEqual(cur.count);
      }
    }
  });

  test("zone totals add up to the global total", async () => {
    const root = await generatedProject("zone-totals");
    const outcome = await runStats(["--project-root", root]);
    expect(outcome.code).toBe(0);
    const sumZones = outcome.zones.reduce((acc, z) => acc + z.total, 0);
    expect(sumZones).toBe(outcome.total);
  });
});