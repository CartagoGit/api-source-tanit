import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main as validateJsonMain } from "../../packages/cli/commands/validate-json.script";
import { POSTMAN_SCHEMA_URL } from "../../packages/contracts/constants/core/postman.constant.js";

let work = "";
beforeAll(async () => { work = await mkdtemp(join(tmpdir(), "validate-schema-")); }, 60_000);
afterAll(async () => { if (work) await rm(work, { recursive: true, force: true }); }, 60_000);

describe("validate-json schema mismatch branch", () => {
  test("reports when info.schema differs from the Postman schema", async () => {
    const dir = join(work, "schema-mismatch");
    await mkdir(dir, { recursive: true });
    const collection = {
      info: { name: "schema-mismatch", schema: "https://example.com/wrong-schema", _postman_id: "abc" },
      item: [
        {
          name: "GET health",
          request: {
            method: "GET",
            header: [{ key: "Accept", value: "application/json" }],
            url: { raw: "http://localhost/health", host: ["localhost"], path: ["/health"] },
          },
        },
      ],
      variable: [],
    };
    await writeFile(join(dir, "postman.postman_collection.json"), JSON.stringify(collection));
    const previous = process.env["POSTMAN_OUTPUT_DIR"];
    process.env["POSTMAN_OUTPUT_DIR"] = dir;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await validateJsonMain([])).toBe(1);
      const printed = [...log.mock.calls, ...error.mock.calls].map((c) => c.join(" ")).join("\n");
      expect(printed).toContain(POSTMAN_SCHEMA_URL);
      expect(printed).toContain("info.schema esperado");
    } finally {
      log.mockRestore();
      error.mockRestore();
      if (previous === undefined) delete process.env["POSTMAN_OUTPUT_DIR"];
      else process.env["POSTMAN_OUTPUT_DIR"] = previous;
    }
  });
});
