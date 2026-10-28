/**
 * Result contract for the universal exporter pipeline.
 *
 * The implementation lives in `packages/contracts`: exporters and their
 * consumers share the shape, and keeping it there prevents a type-only
 * import from dragging exporter implementations into the graph.
 */
export type {
  IExporterDiagnostic,
  IExportResult,
} from "../../contracts/interfaces/core/exporter.interface.js";
