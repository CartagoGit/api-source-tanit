/**
 * `check` on a POST-based RPC API.
 *
 * `check` compares the routes in the code with those in the collection
 * to warn about them going out of sync. It was comparing by **method +
 * URI**, which works in REST because the URL identifies the operation.
 *
 * In GraphQL it does not: there is **one** endpoint, and what
 * distinguishes one query from another is the name. A project with five
 * operations was being counted as one, so `check` could not detect
 * **any** drift — if four disappeared from the code it would still say
 * 1 against 1 and give the green light. The check existed and checked
 * nothing.
 *
 * This is the third time the same assumption bites: it already happened
 * in the pipeline's `dedupeSpecs` and in the duplicate check of the
 * invariants.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CLI_ENTRYPOINT, exampleDir } from "../../scripts/helpers/root.helper";
import { runProcess } from "../helpers/run-process";

let outDir = "";
let collection = "";
const project = exampleDir("graphql");

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), "check-rpc-"));
  await runProcess("bun", [
    "run",
    CLI_ENTRYPOINT,
    "generate",
    "--project-root",
    project,
    "--output-dir",
    outDir,
  ]);
  collection = join(outDir, "sample-graphql.postman_collection.json");
}, 120_000);

afterAll(async () => {
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

async function check(): Promise<{ code: number; out: string }> {
  const result = await runProcess("bun", [
    "run",
    CLI_ENTRYPOINT,
    "check",
    "--project-root",
    project,
    "--output",
    collection,
  ]);
  return { code: result.code, out: result.output };
}

describe("check on GraphQL", () => {
  test("counts the 5 operations, not 1", { timeout: 120_000 }, async () => {
    const { out } = await check();
    expect(out).toMatch(/Routes en source:\s+5/);
    expect(out).toMatch(/Requests in collection:\s+5/);
  });

  test("an up-to-date collection passes", { timeout: 120_000 }, async () => {
    expect((await check()).code).toBe(0);
  });

  // THE test: without it, `check` would pass green with the mutilated
  // collection.
  test("detects that one operation is missing", { timeout: 120_000 }, async () => {
    const original = await readFile(collection, "utf8");
    try {
      const doc = JSON.parse(original) as {
        item: Array<{ item?: unknown[] }>;
      };
      const folder = doc.item.find((f) => Array.isArray(f.item) && f.item.length > 1);
      folder!.item = folder!.item!.slice(1);
      await writeFile(collection, JSON.stringify(doc, null, 2));

      const { code, out } = await check();
      expect(code).toBe(1);
      expect(out).toContain("Missing from the collection");
    } finally {
      await writeFile(collection, original);
    }
  });

  test("says WHICH one is missing, not only how many", { timeout: 120_000 }, async () => {
    const original = await readFile(collection, "utf8");
    try {
      const doc = JSON.parse(original) as { item: Array<{ item?: unknown[] }> };
      const folder = doc.item.find((f) => Array.isArray(f.item) && f.item.length > 1);
      folder!.item = folder!.item!.slice(1);
      await writeFile(collection, JSON.stringify(doc, null, 2));

      // Three identical `POST /graphql` say nothing: the operation name
      // is required to know which one to look for.
      const { out } = await check();
      expect(out).toMatch(/\((query|mutation) \w+\)/);
    } finally {
      await writeFile(collection, original);
    }
  });

  test("the URI does not come out with a double slash", { timeout: 120_000 }, async () => {
    const original = await readFile(collection, "utf8");
    try {
      const doc = JSON.parse(original) as { item: Array<{ item?: unknown[] }> };
      const folder = doc.item.find((f) => Array.isArray(f.item) && f.item.length > 1);
      folder!.item = folder!.item!.slice(1);
      await writeFile(collection, JSON.stringify(doc, null, 2));

      expect((await check()).out).not.toContain("//graphql");
    } finally {
      await writeFile(collection, original);
    }
  });
});
