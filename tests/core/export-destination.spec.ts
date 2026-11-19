import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { planExport, writeExport, writeExportWithPlan } from "../../packages/core/application-api/export-artifacts.helper.js";
import type { IProjectSnapshot } from "../../packages/contracts/interfaces/core/session.interface.js";

describe("export destination shared by preview and write", () => {
  let root: string;
  let snapshot: IProjectSnapshot;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "tanit-export-destination-"));
    snapshot = {
      sessionId: "destination-test",
      projectRoot: root,
      capturedAt: new Date("2026-11-08T00:00:00Z"),
      results: [],
      diagnostics: [],
      frameworks: [],
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test.each(["custom.json", "nested/custom.json"])("honors a relative file name: %s", async (name) => {
    const expected = join(root, name);
    const preview = await planExport(snapshot, "postman", undefined, name);
    expect(preview.outputPath).toBe(expected);
    expect(preview.files.map((file) => file.path)).toEqual([expected]);
    expect(existsSync(expected)).toBe(false);

    const written = await writeExport(snapshot, "postman", undefined, name);
    expect(written.outputPath).toBe(expected);
    expect(written.files).toEqual([expected]);
    expect(JSON.parse(await readFile(expected, "utf8"))).toHaveProperty("item");
    expect((await planExport(snapshot, "postman", undefined, name)).files[0]?.change).toBe("UNCHANGED");
  });

  test("honors an absolute filename", async () => {
    const expected = join(root, "absolute", "named.json");
    const written = await writeExport(snapshot, "postman", undefined, expected);
    expect(written.outputPath).toBe(expected);
    expect(written.files).toEqual([expected]);
    expect(existsSync(expected)).toBe(true);
  });

  test("uses outputDirectory for placement and outputPath for the file name", async () => {
    const expected = join(root, "chosen-directory", "renamed.json");
    const path = join(root, "ignored-directory", "renamed.json");
    const written = await writeExportWithPlan(snapshot, "postman", "chosen-directory", path);
    expect(written.outputPath).toBe(expected);
    expect(written.files).toEqual([expected]);
    expect(written.plan.files.map((file) => file.path)).toEqual(written.files);
    expect(existsSync(expected)).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  test("resolves a relative output directory against the project", async () => {
    const written = await writeExportWithPlan(snapshot, "postman", "generated");
    expect(written.outputPath.startsWith(join(root, "generated") + "/")).toBe(true);
    expect(written.plan.files.map((file) => file.path)).toEqual(written.files);
    expect(existsSync(written.outputPath)).toBe(true);
  });

  test.each([".", "..", "nested/", "nested/..", "nested/."])("rejects a directory supplied as outputPath: %s", async (path) => {
    await expect(writeExport(snapshot, "postman", undefined, path)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
