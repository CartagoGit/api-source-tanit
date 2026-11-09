/**
 * The declarative artifact-building stage of the generation pipeline.
 */
import { describe, expect, test } from "vitest";

import { EXPORT_FORMATS } from "../../packages/contracts/constants/core/export-formats.constant.js";
import type {
  ExportFormatId,
  IExporter,
  IExportResult,
} from "../../packages/contracts/interfaces/core/exporter.interface.js";
import type { IProjectSnapshot } from "../../packages/contracts/interfaces/core/session.interface.js";
import { buildArtifacts } from "../../packages/core/discovery/generation.pipeline.js";
import { selectExporters } from "../../packages/core/exporters/registry.js";

const emptySnapshot: IProjectSnapshot = {
  sessionId: "generation-pipeline-test",
  projectRoot: "/tmp/project",
  capturedAt: new Date("2026-01-01T00:00:00.000Z"),
  results: [],
  diagnostics: [],
  frameworks: [],
};

/** Builds a successful exporter stub. */
function successfulExporter(id: ExportFormatId): IExporter<string> {
  return {
    id,
    capabilities: {
      transports: ["http"],
      schemas: "full",
      responses: "full",
      auth: "full",
      examples: true,
      multiService: true,
    },
    build: async (): Promise<IExportResult<string>> => ({
      format: id,
      artifact: `${id}-artifact`,
      files: [
        {
          path: `${id}.txt`,
          content: `${id}-artifact`,
        },
      ],
      diagnostics: [],
    }),
  };
}

describe("buildArtifacts", () => {
  test("executes the selected exporters declaratively and in order", async () => {
    const exporters = [
      successfulExporter("postman"),
      successfulExporter("openapi"),
      successfulExporter("bruno"),
    ];

    const results = await buildArtifacts(emptySnapshot, exporters);

    expect(results.map((result) => result.format)).toEqual([
      "postman",
      "openapi",
      "bruno",
    ]);
    expect(results.map((result) => result.artifact)).toEqual([
      "postman-artifact",
      "openapi-artifact",
      "bruno-artifact",
    ]);
  });

  test("accumulates a failing exporter as a diagnostic and keeps running", async () => {
    const failing: IExporter = {
      id: "openapi",
      capabilities: {
        transports: ["http"],
        schemas: "partial",
        responses: "lossy",
        auth: "partial",
        examples: true,
        multiService: false,
      },
      build: async (): Promise<IExportResult> => {
        throw new Error("cannot serialize openapi");
      },
    };
    const succeeding = successfulExporter("postman");

    const results = await buildArtifacts(emptySnapshot, [
      failing,
      succeeding,
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]?.format).toBe("openapi");
    expect(results[0]?.artifact).toBeUndefined();
    expect(results[0]?.diagnostics).toEqual([
      expect.objectContaining({
        code: "exporter_failed",
        severity: "error",
        exporterId: "openapi",
        message: expect.stringContaining("cannot serialize openapi"),
      }),
    ]);
    expect(results[1]?.format).toBe("postman");
    expect(results[1]?.artifact).toBe("postman-artifact");
    expect(results[1]?.diagnostics).toEqual([]);
  });
});

describe("the universal exporter registry", () => {
  test("lists Postman beside every legacy exporter", () => {
    expect([...EXPORT_FORMATS]).toEqual([
      "postman",
      "openapi",
      "insomnia",
      "bruno",
      "har",
      "curl",
    ]);
    expect(selectExporters([...EXPORT_FORMATS]).map((exporter) => exporter.id)).toEqual(
      [...EXPORT_FORMATS],
    );
  });

  test("deduplicates formats while preserving the requested order", () => {
    const selected = selectExporters([
      "openapi",
      "postman",
      "openapi",
    ] as ExportFormatId[]);

    expect(selected.map((exporter) => exporter.id)).toEqual([
      "openapi",
      "postman",
    ]);
  });
});
