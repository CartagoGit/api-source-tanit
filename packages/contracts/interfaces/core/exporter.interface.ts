/**
 * Contracts for the universal, format-independent export pipeline.
 *
 * An exporter consumes a project snapshot and produces one result. The
 * pipeline owns orchestration and error accumulation; an exporter only
 * translates one snapshot into the artifact of its format.
 */
import type { ExportFormat } from "../../constants/core/export-formats.constant.js";
import type { ExportDiagnosticSeverity } from "./export.interface.js";
import type { IExportArtifact } from "./export-target.interface.js";
import type { IProjectSnapshot } from "./session.interface.js";
import type { Transport } from "./transport/index.js";

/** A format accepted by the universal exporter registry. */
export type ExportFormatId = ExportFormat;

/**
 * What an exporter can represent without losing information.
 *
 * The values are deliberately coarse: they describe the ceiling of the
 * target format, not the quality of one particular project.
 */
export interface IExporterCapabilities {
  /** Transport kinds the format can express. */
  readonly transports: ReadonlyArray<Transport["kind"]>;
  /** Whether request/response schemas survive the conversion. */
  readonly schemas: "full" | "partial" | "reference";
  /** Whether response descriptions survive the conversion. */
  readonly responses: "full" | "partial" | "lossy";
  /** Whether authentication survives the conversion. */
  readonly auth: "full" | "partial" | "lossy";
  /** Whether examples are emitted. */
  readonly examples: boolean;
  /** Whether operations from several services can coexist. */
  readonly multiService: boolean;
}

/** A problem or caveat produced by an exporter. */
export interface IExporterDiagnostic {
  /** Stable, machine-readable diagnostic code. */
  readonly code: string;
  /** How serious the diagnostic is. */
  readonly severity: ExportDiagnosticSeverity;
  /** Human-readable explanation. */
  readonly message: string;
  /** Exporter that produced the diagnostic. */
  readonly exporterId?: ExportFormatId;
}

/**
 * The result of one exporter.
 *
 * `artifact` is the format-native value (for example a Postman
 * collection). `files` is the write-ready representation used by the
 * CLI. A failed exporter returns diagnostics and no artifact; it never
 * throws out of `buildArtifacts`.
 */
export interface IExportResult<TArtifact = unknown> {
  /** Format produced by this result. */
  readonly format: ExportFormatId;
  /** Format-native artifact, absent when the exporter failed. */
  readonly artifact?: TArtifact;
  /**
   * Files that represent the artifact on disk.
   *
   * An exporter whose artifact IS the primary output — the Postman
   * collection — declares no files here: the writer puts that artifact
   * in the output path the caller chose, and it is not a file of the
   * export directory. Every other exporter declares the files it
   * produced, with each path relative to the export directory.
   */
  readonly files: ReadonlyArray<IExportArtifact>;
  /** Diagnostics raised by this exporter. */
  readonly diagnostics: ReadonlyArray<IExporterDiagnostic>;
}

/**
 * One format implementation consumed by the universal export pipeline.
 *
 * Exporters are pure with respect to the filesystem: `build` resolves
 * an artifact, while the caller decides where and when to write it.
 */
export interface IExporter<TArtifact = unknown> {
  /** Identifier used to select this exporter. */
  readonly id: ExportFormatId;
  /** What the target format can represent. */
  readonly capabilities: IExporterCapabilities;
  /** Builds this format from a project snapshot. */
  build(snapshot: IProjectSnapshot): Promise<IExportResult<TArtifact>>;
}
