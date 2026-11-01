/**
 * The export handler, end to end, against a real project on disk.
 *
 * ## Why this test exists
 *
 * The `export` handler used to answer `{ outputPath, bytes: 0 }`: it
 * computed where the file *would* go and wrote nothing. Its comment
 * called it a synthetic payload to keep the API surface stable — and
 * it did keep the surface stable, and it also kept the app from ever
 * exporting anything. The Export Center drew a beautiful preview of
 * a file that was never created, and its button said the file had
 * been written.
 *
 * The suite of the 14 handlers could not catch it: it drives the
 * orchestrator with a stub, so there was never a project to write.
 * This test opens a **real** project, exports it, and looks at the
 * disk.
 *
 * It lives in `tests/e2e/` because it needs the real orchestrator,
 * and the orchestrator lives with the frameworks.
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { dispatch, type IRequestContext } from "../../packages/core/application-api/dispatcher.js";
import { buildRegistry } from "../../packages/core/application-api/handlers.js";
import { closeAllSessions } from "../../packages/core/session/project-session.service.js";
import { defaultOrchestrator } from "../../packages/frameworks/index.js";
import { exampleDir } from "../../scripts/helpers/root.helper.js";
import { copyExampleClean } from "../helpers/fixtures.js";
import type { DryRunOutput, ExportOutput } from "../../packages/contracts/interfaces/core/application-api.interface.js";

/** The context the handlers need: the real orchestrator and a caller. */
function context(): IRequestContext {
  return { caller: "browser", orchestrator: defaultOrchestrator() };
}

describe("the export handler, end to end", () => {
  let root = "";
  let output = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "export-handler-"));
    output = join(root, "out");
    await copyExampleClean(exampleDir("express"), root);
  }, 60_000);

  afterEach(async () => {
    closeAllSessions();
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("writes the collection, for real", async () => {
    await dispatch(buildRegistry(), "open-project", { projectRoot: root }, context());

    const answer = await dispatch(buildRegistry(), "export", {
      projectRoot: root,
      target: "postman",
      outputDirectory: output,
    }, context());

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const written = answer.value as ExportOutput;
    expect(written.bytes).toBeGreaterThan(0);
    expect(written.files.length).toBeGreaterThan(0);
    expect(existsSync(written.outputPath)).toBe(true);

    const collection = JSON.parse(await readFile(written.outputPath, "utf8")) as {
      item?: ReadonlyArray<unknown>;
    };
    expect(Array.isArray(collection.item)).toBe(true);
    expect(collection.item?.length).toBeGreaterThan(0);
  }, 120_000);

  test("previews without writing anything", async () => {
    await dispatch(buildRegistry(), "open-project", { projectRoot: root }, context());

    const answer = await dispatch(buildRegistry(), "dry-run", {
      projectRoot: root,
      target: "postman",
      outputDirectory: output,
    }, context());

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const preview = answer.value as DryRunOutput;
    expect(preview.files.length).toBeGreaterThan(0);
    expect(preview.endpointCount).toBeGreaterThan(0);
    // Nothing on disk: the dry run only says what would happen.
    expect(existsSync(preview.files[0]!.path)).toBe(false);
    expect(preview.files[0]!.change).toBe("NEW");
  }, 120_000);

  test("says that a second run would not change anything", async () => {
    await dispatch(buildRegistry(), "open-project", { projectRoot: root }, context());
    await dispatch(buildRegistry(), "export", {
      projectRoot: root,
      target: "postman",
      outputDirectory: output,
    }, context());
    const answer = await dispatch(buildRegistry(), "dry-run", {
      projectRoot: root,
      target: "postman",
      outputDirectory: output,
    }, context());

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const preview = answer.value as DryRunOutput;
    expect(preview.files[0]?.change).toBe("UNCHANGED");
  }, 120_000);

  test("refuses a format that does not exist", async () => {
    await dispatch(buildRegistry(), "open-project", { projectRoot: root }, context());

    const answer = await dispatch(buildRegistry(), "export", {
      projectRoot: root,
      target: "papyrus",
    }, context());

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error.message).toContain("Unknown export format");
  }, 120_000);
});
