/** History-producing tests must never touch the developer's persisted records. */
import { afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "tanit-test-history-"));
const previous = process.env["TANIT_HISTORY_DIR"];
const previousLegacy = process.env["TANIT_LEGACY_HISTORY_FILE"];
process.env["TANIT_HISTORY_DIR"] = join(directory, "records");
process.env["TANIT_LEGACY_HISTORY_FILE"] = join(directory, "history.jsonl");
afterAll(async () => {
  if (previous === undefined) delete process.env["TANIT_HISTORY_DIR"]; else process.env["TANIT_HISTORY_DIR"] = previous;
  if (previousLegacy === undefined) delete process.env["TANIT_LEGACY_HISTORY_FILE"]; else process.env["TANIT_LEGACY_HISTORY_FILE"] = previousLegacy;
  await rm(directory, { recursive: true, force: true });
});
