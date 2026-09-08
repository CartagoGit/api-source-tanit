import { afterAll, describe, expect, test } from "vitest";
import { runHistory } from "../../packages/cli/commands/history.script";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempHome = await mkdtemp(join(tmpdir(), "history-edge-"));
const file = join(tempHome, ".tanit", "history.jsonl");
await mkdir(join(tempHome, ".tanit"), { recursive: true });
await writeFile(file, "");

describe("runHistory edge branches", () => {
  test("rejects a non-integer --limit value", async () => {
    const outcome = await runHistory(["--limit", "abc"], { historyPath: file });
    expect(outcome.code).toBe(1);
    expect(outcome.output).toContain("`--limit` expects a positive integer.");
  });

  test("rejects a negative --limit value", async () => {
    const outcome = await runHistory(["--limit", "-3"], { historyPath: file });
    expect(outcome.code).toBe(1);
    expect(outcome.output).toContain("`--limit` expects a positive integer.");
  });
});

afterAll(async () => {
  await rm(tempHome, { recursive: true, force: true });
});
