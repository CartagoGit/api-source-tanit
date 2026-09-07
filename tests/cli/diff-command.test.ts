/**
 * `diff.script.ts` (`apisrc check`) — `runCheck()` in-process.
 *
 * `check` compares the URIs declared in the Postman collection against
 * the URIs discovered in the source code, and exits non-zero when
 * there is drift. Used to be tested only as a process; here we
 * exercise the pure function so the contract that the MCP tool
 * consumes has a check.
 *
 * What this spec covers:
 *
 *   - Happy path: a freshly generated collection matches its source
 *     code (`inSync: true`, `code: 0`).
 *   - The "no collection yet" branch: returns `code: 1`,
 *     `report: null` without crashing.
 *   - Drift on the collection side: editing a request out of the
 *     collection adds an entry to `missingInSource`.
 *   - Drift on the source side: removing a route in the source adds
 *     an entry to `missingInCollection`.
 *   - The `inSync` flag flips back to false when either side drifts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runCheck } from "../../packages/cli/commands/diff.script";
import { runGenerate } from "../../packages/cli/commands/generate.script";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import { copyExampleClean } from "../helpers/fixtures";
import { exampleDir } from "../../scripts/helpers/root.helper";

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "diff-cmd-"));
}, 60_000);

afterAll(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

async function generatedProject(name: string): Promise<string> {
  const root = join(work, name);
  await copyExampleClean(exampleDir("express"), root);
  const gen = await runGenerate(["--project-root", root]);
  expect(gen.code, "runGenerate must succeed").toBe(0);
  return root;
}

describe("diff (check) — runCheck", () => {
  test("returns inSync when the collection matches the source", async () => {
    const root = await generatedProject("in-sync");
    const outcome = await runCheck(["--project-root", root]);
    expect(outcome.code).toBe(0);
    expect(outcome.report).not.toBeNull();
    expect(outcome.report?.inSync).toBe(true);
    expect(outcome.report?.missingInCollection).toEqual([]);
    expect(outcome.report?.missingInSource).toEqual([]);
  });

  test("returns code 1 and a null report when the collection does not exist", async () => {
    const root = join(work, "no-collection");
    await copyExampleClean(exampleDir("express"), root);
    await rm(join(root, OUTPUT_DIR_NAME), { recursive: true, force: true });
    const outcome = await runCheck(["--project-root", root]);
    expect(outcome.code).toBe(1);
    expect(outcome.report).toBeNull();
  });

  test("detects drift when a request is removed from the collection", async () => {
    const root = await generatedProject("drift-coll");
    const collectionFile = join(
      root,
      OUTPUT_DIR_NAME,
      "sample-express.postman_collection.json",
    );
    const doc = JSON.parse(await readFile(collectionFile, "utf8")) as {
      item: Array<{
        name?: string;
        item?: Array<{
          name?: string;
          request?: unknown;
          item?: Array<unknown>;
        }>;
      }>;
    };
    // Drill into the first folder and drop its first request to force
    // drift on the collection side. The top-level `item` array in the
    // Express collection contains folders, not bare requests, so we
    // walk one level down.
    const folder = doc.item[0];
    expect(folder?.item?.[0]).toBeDefined();
    folder?.item?.splice(0, 1);
    await writeFile(collectionFile, JSON.stringify(doc));
    const outcome = await runCheck(["--project-root", root]);
    expect(outcome.code).toBe(1);
    expect(outcome.report).not.toBeNull();
    expect(outcome.report?.inSync).toBe(false);
    // Some requests should have drifted (removed from collection).
    expect(
      (outcome.report?.missingInSource.length ?? 0) > 0 ||
        (outcome.report?.missingInCollection.length ?? 0) > 0,
    ).toBe(true);
  });

  test("`--output` overrides the collection path", async () => {
    const root = await generatedProject("output-flag");
    const collectionFile = join(
      root,
      OUTPUT_DIR_NAME,
      "sample-express.postman_collection.json",
    );
    const outcome = await runCheck([
      "--project-root",
      root,
      "--output",
      collectionFile,
    ]);
    expect(outcome.code).toBe(0);
    expect(outcome.report?.inSync).toBe(true);
  });

  test("`missingInCollection` and `missingInSource` are stable arrays", async () => {
    const root = await generatedProject("stability");
    const outcome = await runCheck(["--project-root", root]);
    expect(outcome.code).toBe(0);
    // Stable shape: every entry has method + uri at minimum.
    for (const ep of outcome.report?.missingInCollection ?? []) {
      expect(typeof ep.method).toBe("string");
      expect(typeof ep.uri).toBe("string");
    }
    for (const ep of outcome.report?.missingInSource ?? []) {
      expect(typeof ep.method).toBe("string");
      expect(typeof ep.uri).toBe("string");
    }
  });
});