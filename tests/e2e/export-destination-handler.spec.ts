import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dispatch } from "../../packages/core/application-api/dispatcher.js";
import { buildRegistry } from "../../packages/core/application-api/handlers.js";
import { closeAllSessions, getSession } from "../../packages/core/session/project-session.service.js";
import { planExport } from "../../packages/core/application-api/export-artifacts.helper.js";
import type { ExportOutput } from "../../packages/contracts/interfaces/core/application-api.interface.js";
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
    const answer = await dispatch<ExportOutput>(registry, "export", {
      projectRoot: root, target, outputPath: "custom-output.json",
    }, context);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.outputPath).toBe(expected);
    expect(answer.value.files).toEqual([expected]);
    expect((await readFile(expected, "utf8")).length).toBeGreaterThan(0);
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

  test("rejects a filename for a multi-file format before writing", async () => {
    const answer = await dispatch(registry, "export", {
      projectRoot: root, target: "bruno", outputPath: "bruno-output/custom.json",
    }, context);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error.code).toBe("INVALID_INPUT");
    expect(answer.error.message).toContain("outputDirectory");
    expect(existsSync(join(root, "bruno-output"))).toBe(false);
  });
});
