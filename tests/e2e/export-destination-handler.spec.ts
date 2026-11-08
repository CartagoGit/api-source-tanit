import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { dispatch } from "../../packages/core/application-api/dispatcher.js";
import { buildRegistry } from "../../packages/core/application-api/handlers.js";
import { closeAllSessions, getSession } from "../../packages/core/session/project-session.service.js";
import { planExport } from "../../packages/core/application-api/export-artifacts.helper.js";
import type { DryRunOutput, ExportOutput, SyncOutput } from "../../packages/contracts/interfaces/core/application-api.interface.js";
import { OUTPUT_DIR_NAME } from "../../packages/contracts/constants/core/postman.constant.js";
import { defaultOrchestrator } from "../../packages/frameworks/index.js";
import { exampleDir } from "../../scripts/helpers/root.helper.js";
import { copyExampleClean } from "../helpers/fixtures.js";

describe("export reports the files it really writes", () => {
  let root: string;
  const registry = buildRegistry();
  const context = { caller: "browser" as const, orchestrator: defaultOrchestrator() };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "tanit-export-path-handler-"));
    await copyExampleClean(exampleDir("express"), root);
    const opened = await dispatch(registry, "open-project", { projectRoot: root }, context);
    expect(opened.ok).toBe(true);
  });

  afterEach(async () => {
    closeAllSessions();
    await rm(root, { recursive: true, force: true });
  });

  test.each(["postman", "openapi"])("writes a custom relative filename for %s", async (target) => {
    const expected = join(root, "custom-output.json");
    const input = {
      projectRoot: root, target, outputPath: "custom-output.json",
    };
    const preview = await dispatch<DryRunOutput>(registry, "dry-run", input, context);
    const syncPreview = await dispatch<SyncOutput>(registry, "sync", { ...input, dryRun: true }, context);
    expect(preview.ok).toBe(true);
    expect(syncPreview.ok).toBe(true);
    if (!preview.ok || !syncPreview.ok) return;
    expect(preview.value.files.map((file) => file.path)).toEqual([expected]);
    expect(syncPreview.value.plannedFiles).toEqual(preview.value.files);
    expect(existsSync(expected)).toBe(false);

    const answer = await dispatch<ExportOutput>(registry, "export", input, context);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.outputPath).toBe(expected);
    expect(answer.value.files).toEqual([expected]);
    expect((await readFile(expected, "utf8")).length).toBeGreaterThan(0);
    const synced = await dispatch<SyncOutput>(registry, "sync", input, context);
    expect(synced.ok).toBe(true);
    if (!synced.ok) return;
    expect(synced.value.files).toEqual(answer.value.files);
    expect(synced.value.plannedFiles.map((file) => file.path)).toEqual(answer.value.files);
  });

  test("public preview and write use the same directory and filename precedence", async () => {
    const input = {
      projectRoot: root, target: "postman",
      outputDirectory: "chosen-directory", outputPath: "ignored-directory/custom.json",
    };
    const expected = join(root, "chosen-directory", "custom.json");
    const preview = await dispatch<DryRunOutput>(registry, "dry-run", input, context);
    const synced = await dispatch<SyncOutput>(registry, "sync", input, context);
    expect(preview.ok).toBe(true);
    expect(synced.ok).toBe(true);
    if (!preview.ok || !synced.ok) return;
    expect(preview.value.files.map((file) => file.path)).toEqual([expected]);
    expect(synced.value.files).toEqual([expected]);
    expect(existsSync(expected)).toBe(true);
    expect(existsSync(join(root, "ignored-directory"))).toBe(false);
  });

  test("a relative project root has the same default destination in every public path", async () => {
    closeAllSessions();
    await rm(root, { recursive: true, force: true });
    root = await mkdtemp(join(process.cwd(), "tanit-relative-export-"));
    await copyExampleClean(exampleDir("express"), root);
    const relativeRoot = relative(process.cwd(), root);
    const opened = await dispatch(registry, "open-project", { projectRoot: relativeRoot }, context);
    expect(opened.ok).toBe(true);
    const input = { projectRoot: relativeRoot, target: "postman" };
    const preview = await dispatch<DryRunOutput>(registry, "dry-run", input, context);
    const syncPreview = await dispatch<SyncOutput>(registry, "sync", { ...input, dryRun: true }, context);
    const written = await dispatch<ExportOutput>(registry, "export", input, context);
    expect(preview.ok).toBe(true);
    expect(syncPreview.ok).toBe(true);
    expect(written.ok).toBe(true);
    if (!preview.ok || !syncPreview.ok || !written.ok) return;
    const expected = written.value.files;
    expect(expected.every((path) => path.startsWith(join(root, OUTPUT_DIR_NAME) + "/"))).toBe(true);
    expect(preview.value.files.map((file) => file.path)).toEqual(expected);
    expect(syncPreview.value.plannedFiles.map((file) => file.path)).toEqual(expected);
    const synced = await dispatch<SyncOutput>(registry, "sync", input, context);
    expect(synced.ok).toBe(true);
    if (!synced.ok) return;
    expect(synced.value.files).toEqual(expected);
    expect(written.value.historyId).toBeDefined();
    const reExport = await dispatch<ExportOutput>(registry, "history-re-export", {
      projectRoot: relativeRoot, historyId: written.value.historyId,
    }, context);
    expect(reExport.ok).toBe(true);
    if (!reExport.ok) return;
    expect(reExport.value.files).toEqual(expected);
    expect(expected.every((path) => existsSync(path))).toBe(true);
  });

  test("preserves every file and its layout for a directory export", async () => {
    const session = getSession(root);
    expect(session).toBeDefined();
    const preview = await planExport(session!.current(), "bruno", "bruno-output");
    const answer = await dispatch<ExportOutput>(registry, "export", {
      projectRoot: root, target: "bruno", outputDirectory: "bruno-output",
    }, context);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.files).toEqual(preview.files.map((file) => file.path));
    expect(answer.value.files.length).toBeGreaterThan(1);
    expect(answer.value.files.every((file) => existsSync(file))).toBe(true);
    expect(answer.value.files).toContain(answer.value.outputPath);
  });

  test.each(["export", "dry-run", "sync"])("%s rejects a filename for a multi-file format before writing", async (operation) => {
    const answer = await dispatch(registry, operation, {
      projectRoot: root, target: "bruno", outputPath: "bruno-output/custom.json",
    }, context);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error.code).toBe("INVALID_INPUT");
    expect(answer.error.message).toContain("outputDirectory");
    expect(existsSync(join(root, "bruno-output"))).toBe(false);
  });
});
