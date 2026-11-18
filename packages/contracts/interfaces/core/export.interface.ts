/**
 * The export, as the Export Center shows it.
 *
 * ## What it used to be
 *
 * A whole model of an export that never happened: the client rendered
 * the artifacts **itself** from a list of operations it made up, kept
 * them in a `Map` in memory, and answered "here is your file" for
 * files that were never written. The preview showed paths, sizes and
 * overwrite risks computed from strings the app had made up itself.
 *
 * The API writes for real now, and this is the view of what it
 * said. Every path, every size and every "this would overwrite"
 * comes from the backend's own dry run.
 */
import type { ExportFormat } from "../../constants/core/export-formats.constant.js";

export type { ExportFormat } from "../../constants/core/export-formats.constant.js";
export type ExportChange = "NEW" | "UPDATE" | "UNCHANGED";
export type ExportDiagnosticSeverity = "info" | "warning" | "error";

/** What a format can and cannot represent, in the core's own words. */
export interface ExportCapabilities {
  readonly format: ExportFormat;
  readonly label: string;
  readonly summary: string;
}

export interface ExportDiagnostic {
  /** The exporter's own code, not one the UI made up. */
  readonly code: string;
  readonly severity: ExportDiagnosticSeverity;
  readonly message: string;
  /**
   * What to do about it, when the exporter said.
   *
   * Absent when nobody said: the app used to write the same
   * sentence on every warning, which is advice nobody gave.
   */
  readonly suggestion?: string;
}

/** One file the backend would write. */
export interface ExportFilePreview {
  /** Absolute path. */
  readonly path: string;
  readonly change: ExportChange;
  /** The size the file would have. */
  readonly bytes: number;
  /** Whether writing it would replace something that is already there. */
  readonly overwriteRisk: boolean;
  /** Whether it would land outside the project. */
  readonly outsideWorkspace: boolean;
}

/** What the backend would do, without doing it. */
export interface ExportDryRun {
  readonly files: readonly ExportFilePreview[];
  readonly diagnostics: readonly ExportDiagnostic[];
  readonly canGenerate: boolean;
  readonly requiresOverwriteConfirmation: boolean;
  readonly requiresOutsideWorkspaceConfirmation: boolean;
}

/** What was written. */
export interface ExportResult {
  readonly files: ReadonlyArray<{ readonly path: string }>;
  readonly outputDirectory: string;
}
