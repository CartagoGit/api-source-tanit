/**
 * f00014 follow-up: end-to-end test that runs the CLI binary against
 * the NestJS response-inference fixture and asserts the resulting
 * Postman collection carries `response[]` on at least one item.
 *
 * The bug we are pinning: before this slice, the CLI ran the
 * `inferResponses()` loop AFTER `pipeline.collection` had already
 * been serialised to JSON. The `response[]` block was therefore
 * never written to disk, even though the dispatcher happily produced
 * entries. The fix moves the loop into the pipeline (`buildForService`)
 * BEFORE `buildCollection()`, so every Postman JSON the user sees has
 * the inferred entries.
 *
 * We invoke the CLI as a subprocess (`runProcess`) on purpose: the
 * in-process helper `tests/helpers/run-scanner.ts` could mask a
 * regression if the script path ever diverges from the pipeline path.
 * The CLI is the user-facing surface; if the user sees a regression
 * here, it counts as a real bug.
 */
import { expect, test } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";

import { runProcess } from "../helpers/run-process";
import { CLI_COMMANDS_DIR, REPO_ROOT } from "../../scripts/helpers/root.helper";

const GENERATE = join(CLI_COMMANDS_DIR, "generate.script.ts");
const FIXTURE = join(REPO_ROOT, "tests/fixtures/nestjs-response-inference");

test("CLI: Postman JSON carries the inferred response[] block (f00014 follow-up)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "f00014-cli-"));
  try {
    const project = join(dir, "proj");
    await cp(FIXTURE, project, { recursive: true });

    // Run the CLI without --inspect / --json so the disk-written
    // collection.json is the file we inspect — exactly the user
    // path that was broken before.
    const result = await runProcess("bun", [
      GENERATE,
      "--project-root", project,
      "--allow-empty",
    ], { cwd: REPO_ROOT });

    expect(result.code).toBe(0);
    const collectionPath = join(project, "tanit/nestjs-response-inference-fixture.postman_collection.json");
    const raw = await readFile(collectionPath, "utf8");
    const collection = JSON.parse(raw) as {
      item: ReadonlyArray<{ item?: ReadonlyArray<unknown>; response?: ReadonlyArray<unknown> }>;
    };

    let found = 0;
    const walk = (items: ReadonlyArray<{ item?: ReadonlyArray<unknown>; response?: ReadonlyArray<unknown> }>) => {
      for (const item of items) {
        if (Array.isArray(item.response) && item.response.length > 0) found++;
        if (Array.isArray(item.item)) walk(item.item as ReadonlyArray<{ item?: ReadonlyArray<unknown>; response?: ReadonlyArray<unknown> }>);
      }
    };
    walk(collection.item);
    expect(found).toBeGreaterThan(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
