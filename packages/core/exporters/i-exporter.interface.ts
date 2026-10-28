/**
 * The universal exporter contract, as the exporters package exposes it.
 *
 * The canonical declarations live in `packages/contracts`, as required
 * by the repository's contract-placement gate: a shared type does not
 * belong to the package that happens to implement it. This module is
 * the path the exporters package offers to its own consumers, so the
 * registry and the exporters speak the contract without reaching into
 * the contracts package for every import.
 */
export type {
  ExportFormatId,
  IExporter,
  IExporterCapabilities,
  IExporterCapabilities as ExportCapabilities,
} from "../../contracts/interfaces/core/exporter.interface.js";
export type { IExporterDiagnostic, IExportResult } from "./result.js";
