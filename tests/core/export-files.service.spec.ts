import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prepareExport, writePreparedExport } from "../../packages/core/exporters/export-files.service.js";
import { planExport as planApiExport } from "../../packages/core/application-api/export-artifacts.helper.js";
import { selectExporters } from "../../packages/core/exporters/registry.js";
import { generateCollection } from "../../packages/core/discovery/generation.pipeline.js";
import { DiscoveryOrchestrator } from "../../packages/core/discovery/discovery.orchestrator.js";
import type { IProjectSnapshot } from "../../packages/contracts/interfaces/core/session.interface.js";
import type { IGenerationResult } from "../../packages/contracts/interfaces/core/discovery.interface.js";

vi.mock("../../packages/core/exporters/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../packages/core/exporters/registry.js")>();
  return { ...actual, selectExporters: vi.fn(actual.selectExporters) };
});

describe("prepared export files", () => {
  let root: string;

  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "tanit-prepared-files-")); });
  afterEach(async () => {
    vi.mocked(selectExporters).mockReset();
    await rm(root, { recursive: true, force: true });
  });

  test("prepares once and writes the exact previewed content and byte count", async () => {
    const build = vi.fn().mockResolvedValue({
      format: "postman", artifact: { info: { name: "API 🌍" }, item: [] }, files: [], diagnostics: [],
    });
    vi.mocked(selectExporters).mockReturnValueOnce([{
      id: "postman", build,
      capabilities: { transports: ["http"], schemas: "full", responses: "full", auth: "full", examples: true, multiService: true },
    }]);
    const snapshot: IProjectSnapshot = {
      sessionId: "prepared-export", projectRoot: root, capturedAt: new Date(),
      results: [], diagnostics: [], frameworks: [],
    };
    const plan = await prepareExport(snapshot, "postman", undefined, "preview.json");
    expect(existsSync(plan.outputPath)).toBe(false);
    const written = await writePreparedExport(plan);
    expect(build).toHaveBeenCalledOnce();
    expect(written.files).toEqual(plan.files.map((file) => file.path));
    const content = await readFile(written.outputPath, "utf8");
    expect(content).toBe(plan.files[0]?.content);
    expect(written.bytes).toBe(Buffer.from(content).length);
    expect(written.plan.files.map((file) => file.path)).toEqual(written.files);
  });

  test("core invokes an injected preparation hook before exposing the result", async () => {
    const prepareResult = vi.fn(async (result: IGenerationResult): Promise<IGenerationResult> => ({
      ...result, warnings: [...result.warnings, "Prepared by an injected provider"],
    }));
    const orchestrator = new DiscoveryOrchestrator({
      detectors: [], routeScanners: [], validationProviders: [], prepareResult,
    });
    const result = await generateCollection(root, { orchestrator });
    expect(prepareResult).toHaveBeenCalledOnce();
    expect(result.warnings).toContain("Prepared by an injected provider");
  });

  test("the API adapter preserves serializable domain error messages", async () => {
    const snapshot: IProjectSnapshot = {
      sessionId: "invalid-format", projectRoot: root, capturedAt: new Date(),
      results: [], diagnostics: [], frameworks: [],
    };
    const error = await planApiExport(snapshot, "invalid-format").catch((error: unknown) => error);
    expect(JSON.parse(JSON.stringify(error))).toMatchObject({
      code: "INVALID_INPUT", message: expect.stringContaining("invalid-format"),
    });
  });

  test("every host rejects a malformed Postman artifact before writing", async () => {
    const actual = await vi.importActual<typeof import("../../packages/core/exporters/registry.js")>(
      "../../packages/core/exporters/registry.js",
    );
    const exporter = actual.selectExporters(["postman"])[0]!;
    vi.mocked(selectExporters).mockReturnValueOnce([{
      ...exporter,
      build: vi.fn().mockResolvedValue({ format: "postman", artifact: {}, files: [], diagnostics: [] }),
    }]);
    const snapshot: IProjectSnapshot = {
      sessionId: "malformed-artifact", projectRoot: root, capturedAt: new Date(),
      results: [], diagnostics: [], frameworks: [],
    };
    await expect(prepareExport(snapshot, "postman", undefined, "malformed.json"))
      .rejects.toMatchObject({ code: "EXPORT_FAILED" });
    expect(existsSync(join(root, "malformed.json"))).toBe(false);
  });
});
