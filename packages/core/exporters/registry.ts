/**
 * Universal exporter registry.
 *
 * The legacy `export-registry.service.ts` owns the five serializers that
 * implement `IExportTarget`. This module is the layer above it: every
 * format, including Postman, is exposed through the same `IExporter`
 * contract and selected through one exhaustive id list.
 *
 * Keeping both layers is deliberate, not a duplicate registry:
 *
 *   - `export-registry.service.ts` answers "which legacy target can
 *     serialize this catalog?".
 *   - `registry.ts` answers "which universal exporter builds this
 *     snapshot?".
 *
 * The legacy targets are obtained from the existing service instead of
 * being instantiated a second time.
 */
import type {
  ExportFormatId,
  IExporter,
  IExporterCapabilities,
  IExportResult,
} from "../../contracts/interfaces/core/exporter.interface.js";
import type {
  IExportArtifact,
  IExportInput,
  IExportTarget,
} from "../../contracts/interfaces/core/export-target.interface.js";
import type { IProjectSnapshot } from "../../contracts/interfaces/core/session.interface.js";
import { exporterFor } from "./export-registry.service.js";
import { PostmanExporter } from "./postman.exporter.js";

/** Capabilities shared by the legacy HTTP-only serializers. */
function legacyCapabilities(
  format: ExportFormatId,
): IExporterCapabilities {
  switch (format) {
    case "openapi":
      return {
        transports: ["http"],
        schemas: "partial",
        responses: "lossy",
        auth: "partial",
        examples: true,
        multiService: false,
      };
    case "insomnia":
    case "bruno":
    case "har":
    case "curl":
      return {
        transports: ["http"],
        schemas: "partial",
        responses: "lossy",
        auth: "partial",
        examples: true,
        multiService: false,
      };
    case "postman":
      return {
        transports: ["http"],
        schemas: "partial",
        responses: "partial",
        auth: "partial",
        examples: true,
        multiService: true,
      };
  }
}

/** Converts a discovery result into the input expected by a legacy target. */
function exportInputFromSnapshot(
  snapshot: IProjectSnapshot,
): IExportInput | null {
  const result = snapshot.results[0];
  if (result === undefined) return null;

  return {
    specs: result.specs,
    config: result.config,
    auth: {
      type: result.authScheme.type,
      ...(result.authScheme.keyName !== undefined
        ? { keyName: result.authScheme.keyName }
        : {}),
      ...(result.authScheme.keyIn !== undefined
        ? { keyIn: result.authScheme.keyIn }
        : {}),
    },
  };
}

/**
 * Adapts the pre-r00019 `IExportTarget` contract to the universal
 * `IExporter` contract.
 *
 * The adapter is temporary infrastructure, not a second implementation
 * of each format: serialization still happens in the existing exporter.
 */
class LegacyExporterAdapter
  implements IExporter<ReadonlyArray<IExportArtifact>>
{
  readonly id: ExportFormatId;
  readonly capabilities: IExporterCapabilities;

  constructor(
    id: ExportFormatId,
    private readonly target: IExportTarget,
  ) {
    this.id = id;
    this.capabilities = legacyCapabilities(id);
  }

  async build(
    snapshot: IProjectSnapshot,
  ): Promise<IExportResult<ReadonlyArray<IExportArtifact>>> {
    const input = exportInputFromSnapshot(snapshot);
    if (input === null) {
      return {
        format: this.id,
        files: [],
        diagnostics: [
          {
            code: "empty_snapshot",
            severity: "warning",
            message: `The ${this.id} exporter received a snapshot without results.`,
            exporterId: this.id,
          },
        ],
      };
    }

    const files = this.target.serialize(input);
    const warnings = this.target.warnings?.(input) ?? [];
    return {
      format: this.id,
      artifact: files,
      files,
      diagnostics: warnings.map((message) => ({
        code: "export_warning",
        severity: "warning" as const,
        message,
        exporterId: this.id,
      })),
    };
  }
}

/** Every universal exporter, keyed by its exhaustive format id. */
const EXPORTERS = new Map<ExportFormatId, IExporter>();
EXPORTERS.set("postman", new PostmanExporter());
for (const format of ["openapi", "insomnia", "bruno", "har", "curl"] as const) {
  const target = exporterFor(format);
  if (target === null) {
    throw new Error(`Missing legacy exporter for format: ${format}`);
  }
  EXPORTERS.set(format, new LegacyExporterAdapter(format, target));
}

/**
 * Selects exporters by format id, preserving the caller's order.
 *
 * Unknown ids throw instead of being ignored: a misspelled format must
 * not look like a successful run that produced fewer files.
 */
function selectExporters(formats: ExportFormatId[]): IExporter[] {
  const selected: IExporter[] = [];
  const seen = new Set<ExportFormatId>();

  for (const format of formats) {
    if (seen.has(format)) continue;
    const exporter = EXPORTERS.get(format);
    if (exporter === undefined) {
      throw new Error(`Unknown export format: ${format}`);
    }
    seen.add(format);
    selected.push(exporter);
  }

  return selected;
}

export { EXPORTER_IDS } from "../../contracts/constants/core/exporter-ids.constant.js";
export { selectExporters };
