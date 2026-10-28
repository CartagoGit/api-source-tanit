/**
 * The result of one exporter, as the exporters package exposes it.
 *
 * The canonical declaration lives in `packages/contracts`: exporters and
 * their consumers share the shape, and keeping it there prevents a
 * type-only import from dragging exporter implementations into the
 * graph. This module is the path the exporters package offers to its own
 * consumers.
 */
export type {
  IExporterDiagnostic,
  IExportResult,
} from "../../contracts/interfaces/core/exporter.interface.js";
