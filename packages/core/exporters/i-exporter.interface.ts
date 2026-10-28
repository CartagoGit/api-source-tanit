/**
 * Compatibility facade for the universal exporter contract.
 *
 * The canonical declarations live in `packages/contracts`, as required
 * by the repository's contract-placement gate. This module keeps the
 * historical exporter-facing import path available to core consumers.
 */
export type {
  ExportFormatId,
  IExporter,
  IExporterCapabilities as ExportCapabilities,
  IExporterDiagnostic,
  IExportResult,
} from "../../contracts/interfaces/core/exporter.interface.js";
