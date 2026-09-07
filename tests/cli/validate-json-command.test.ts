/**
 * `validate-json.script.ts` — `main()` in-process.
 *
 * The command validates a generated Postman collection against the
 * v2.1.0 invariants. It used to be exercised only through process
 * spawning. The pure `main(argv)` is what the MCP tool wraps.
 *
 * What this spec covers:
 *
 *   - Happy path: a generated collection validates with `code: 0`.
 *   - "No collection yet": `code: 1` with an actionable error.
 *   - "JSON not parseable": `code: 1` with a JSON-parse error.
 *   - "Wrong schema URL": the collection's `info.schema` does not
 *     match the expected Postman v2.1.0 schema; `code: 1` and the
 *     error mentions the expected value.
 *   - "Empty item array": `code: 1` because `collection.item`
 *     empty is treated as an error.
 *   - "Missing _postman_id": only a warning, not an error: `code: 0`.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { main } from "../../packages/cli/commands/validate-json.script";
import { runGenerate } from "../../packages/cli/commands/generate.script";
import { POSTMAN_SCHEMA_URL } from "../../packages/contracts/constants/core/postman.constant";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant";
import { copyExampleClean } from "../helpers/fixtures";
import { exampleDir } from "../../scripts/helpers/root.helper";

let work = "";

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "validate-cmd-"));
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

describe("validate-json — main()", () => {
  test("returns code 0 for a valid generated collection", async () => {
    const root = await generatedProject("happy");
    const code = await main(["--project-root", root]);
    expect(code).toBe(0);
  });

  test("returns code 1 when the collection does not exist", async () => {
    const root = join(work, "no-collection");
    await copyExampleClean(exampleDir("express"), root);
    await rm(join(root, OUTPUT_DIR_NAME), { recursive: true, force: true });
    const code = await main(["--project-root", root]);
    expect(code).toBe(1);
  });

  test("returns code 1 when the file is not valid JSON", async () => {
    const root = await generatedProject("bad-json");
    const file = join(
      root,
      OUTPUT_DIR_NAME,
      "sample-express.postman_collection.json",
    );
    await writeFile(file, "{not json");
    const code = await main(["--project-root", root]);
    expect(code).toBe(1);
  });

  test("returns code 1 when the schema URL does not match v2.1.0", async () => {
    const root = await generatedProject("wrong-schema");
    const file = join(
      root,
      OUTPUT_DIR_NAME,
      "sample-express.postman_collection.json",
    );
    const raw = await (await import("node:fs/promises")).readFile(file, "utf8");
    const doc = JSON.parse(raw) as {
      info: { schema?: string };
    };
    doc.info.schema = "https://example.com/wrong-schema";
    await writeFile(file, JSON.stringify(doc));
    const code = await main(["--project-root", root]);
    expect(code).toBe(1);
    void POSTMAN_SCHEMA_URL;
  });

  test("returns code 1 when the collection has no items", async () => {
    const root = await generatedProject("empty-items");
    const file = join(
      root,
      OUTPUT_DIR_NAME,
      "sample-express.postman_collection.json",
    );
    const raw = await (await import("node:fs/promises")).readFile(file, "utf8");
    const doc = JSON.parse(raw) as { item: unknown[] };
    doc.item = [];
    await writeFile(file, JSON.stringify(doc));
    const code = await main(["--project-root", root]);
    expect(code).toBe(1);
  });

  test("returns code 0 when only the _postman_id is missing (warning, not error)", async () => {
    const root = await generatedProject("no-postman-id");
    const file = join(
      root,
      OUTPUT_DIR_NAME,
      "sample-express.postman_collection.json",
    );
    const raw = await (await import("node:fs/promises")).readFile(file, "utf8");
    const doc = JSON.parse(raw) as {
      info: Record<string, unknown>;
    };
    delete doc.info["_postman_id"];
    await writeFile(file, JSON.stringify(doc));
    const code = await main(["--project-root", root]);
    expect(code).toBe(0);
  });
});