/**
 * The Export Center, against the real backend.
 *
 * ## What these tests are for
 *
 * The export client used to **render the artifacts in the browser**:
 * it built a Postman collection, an OpenAPI document and four other
 * formats from a list of operations it had made up, and kept them in
 * a `Map`. The Export Center showed a preview with paths and sizes
 * that had nothing to do with the files the exporter produces, and
 * the "Generate" button stored the files in memory and said they had
 * been written.
 *
 * These tests check the opposite: the client asks the backend, the
 * preview is the backend's answer, and the export is the backend's
 * write.
 */
import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";

import { ExportsClient } from "../../packages/app/src/app/core/api/exports.client";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";

/** A bridge that answers with a dry run and an export. */
function fakeBridge(): {
  bridge: { request: (operation: string, input: unknown) => Promise<unknown> };
  calls: Array<{ operation: string; input: unknown }>;
} {
  const calls: Array<{ operation: string; input: unknown }> = [];
  const bridge = {
    request: vi.fn(async (operation: string, input: unknown) => {
      calls.push({ operation, input });
      if (operation === "dry-run") {
        const directory =
          typeof input === "object" && input !== null && "outputDirectory" in input
            ? String((input as { outputDirectory?: string }).outputDirectory ?? "/workspace/tanit")
            : "/workspace/tanit";
        return {
          endpointCount: 12,
          frameworks: ["express"],
          warnings: [],
          durationMs: 4,
          files: [
            { path: `${directory}/api.json`, change: "NEW", bytes: 2048 },
            { path: `${directory}/api.postman_collection.json`, change: "UPDATE", bytes: 4096 },
          ],
          formats: [{ id: "postman", summary: "Collection and environments for Postman" }],
        };
      }
      if (operation === "export") {
        return {
          outputPath: "/workspace/tanit/api.json",
          bytes: 6144,
          files: ["/workspace/tanit/api.json", "/workspace/tanit/api.postman_collection.json"],
        };
      }
      throw new Error(`unexpected operation: ${operation}`);
    }),
  };
  return { bridge, calls };
}

describe("ExportsClient", () => {
  it("asks the backend for the dry run and draws its answer", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [ExportsClient, { provide: HostBridgeClient, useValue: bridge }],
    });
    const client = TestBed.inject(ExportsClient);

    const preview = await client.preview("/workspace", "postman", "/workspace/tanit", "/workspace");

    expect(calls[0]?.operation).toBe("dry-run");
    expect(calls[0]?.input).toMatchObject({
      projectRoot: "/workspace",
      target: "postman",
      outputDirectory: "/workspace/tanit",
    });
    expect(preview.files).toHaveLength(2);
    // The overwrite risk is the backend's own verdict, not a guess.
    expect(preview.files[0]?.overwriteRisk).toBe(false);
    expect(preview.files[1]?.overwriteRisk).toBe(true);
    expect(preview.requiresOverwriteConfirmation).toBe(true);
    expect(preview.canGenerate).toBe(true);
  });

  it("marks a file that would land outside the project", async () => {
    const { bridge } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [ExportsClient, { provide: HostBridgeClient, useValue: bridge }],
    });
    const client = TestBed.inject(ExportsClient);

    const preview = await client.preview("/workspace", "postman", "/elsewhere", "/workspace");

    expect(preview.files.every((file) => file.outsideWorkspace)).toBe(true);
    expect(preview.requiresOutsideWorkspaceConfirmation).toBe(true);
  });

  it("writes through the backend", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [ExportsClient, { provide: HostBridgeClient, useValue: bridge }],
    });
    const client = TestBed.inject(ExportsClient);

    const result = await client.generate("/workspace", "postman", "/workspace/tanit");

    expect(calls[0]?.operation).toBe("export");
    expect(result.files).toHaveLength(2);
    expect(result.outputDirectory).toBe("/workspace/tanit");
  });

  it("takes the format descriptions from the core", async () => {
    const { bridge } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [ExportsClient, { provide: HostBridgeClient, useValue: bridge }],
    });
    const client = TestBed.inject(ExportsClient);

    const capabilities = await client.capabilities("/workspace");

    expect(capabilities[0]).toEqual({
      format: "postman",
      label: "postman",
      summary: "Collection and environments for Postman",
    });
  });
});
