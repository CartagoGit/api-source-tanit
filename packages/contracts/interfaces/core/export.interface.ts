import type { ExportFormat } from "../../constants/core/export-formats.constant.js";

export type { ExportFormat } from "../../constants/core/export-formats.constant.js";
export type ExportChange = "NEW" | "UPDATE" | "UNCHANGED";
export type ExportDiagnosticSeverity = "info" | "warning" | "error";

export interface ExportCapabilities {
  readonly format: ExportFormat;
  readonly label: string;
  readonly supported: boolean;
  readonly lossy: boolean;
  readonly counts: Readonly<Record<string, number>>;
  readonly note: string;
}

export interface ExportDiagnostic {
  readonly code: string;
  readonly severity: ExportDiagnosticSeverity;
  readonly operationIds: readonly string[];
  readonly message: string;
  readonly suggestion: string;
}

export interface ExportFilePreview {
  readonly path: string;
  readonly change: ExportChange;
  readonly overwriteRisk: boolean;
  readonly outsideWorkspace: boolean;
  readonly content: string;
}

export interface CombinedExportStatus {
  readonly partial: boolean;
  readonly explanation: string;
  readonly services: ReadonlyArray<{ readonly serviceId: string; readonly reason: string }>;
  readonly operationRefs: Readonly<Record<string, { readonly serverRef?: string; readonly authRef?: string }>>;
}

export interface ExportDryRun {
  readonly files: readonly ExportFilePreview[];
  readonly diagnostics: readonly ExportDiagnostic[];
  readonly canGenerate: boolean;
  readonly requiresOverwriteConfirmation: boolean;
  readonly requiresOutsideWorkspaceConfirmation: boolean;
  readonly combinedExport?: CombinedExportStatus;
}

export interface ExportOperation {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly description?: string;
  readonly diagnostics?: readonly ExportDiagnostic[];
}

export interface ExportExistingFile {
  readonly path: string;
  readonly content: string;
}

export interface ExportRequest {
  readonly formats: readonly ExportFormat[];
  readonly outputDirectory: string;
  readonly workspaceRoot: string;
  readonly endpointCount: number;
  readonly operations?: readonly ExportOperation[];
  readonly existingFiles?: readonly ExportExistingFile[];
  readonly overwriteConfirmed?: boolean;
  readonly outsideWorkspaceConfirmed?: boolean;
  readonly combinedExport?: CombinedExportStatus;
}

export interface ExportResult {
  readonly files: readonly ExportFilePreview[];
  readonly outputDirectory: string;
  readonly postmanInstalled: boolean;
}

export interface ExportArtifactWriter {
  write(path: string, content: string): Promise<void>;
}
