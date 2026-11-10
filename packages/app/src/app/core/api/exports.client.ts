import { Injectable, inject } from "@angular/core";

import { EXPORT_FORMATS, type ExportFormat } from "../../../../../contracts/constants/core/export-formats.constant";
import type {
  ExportCapabilities,
  ExportDiagnostic,
  ExportDryRun,
  ExportFilePreview,
  ExportResult,
} from "../../../../../contracts/interfaces/core/export.interface";
import type {
  DryRunOutput,
  ExportOutput,
} from "../../../../../contracts/interfaces/core/application-api.interface";
import { HostBridgeClient } from "./host-bridge.client";

export { EXPORT_FORMATS } from "../../../../../contracts/constants/core/export-formats.constant";
export type { ExportFormat } from "../../../../../contracts/constants/core/export-formats.constant";
export type {
  ExportCapabilities,
  ExportChange,
  ExportDiagnostic,
  ExportDiagnosticSeverity,
  ExportDryRun,
  ExportFilePreview,
  ExportResult,
} from "../../../../../contracts/interfaces/core/export.interface";

/**
 * The Export Center talks to the backend.
 *
 * ## What it used to do
 *
 * It rendered the artifacts **in the browser**: `renderArtifact()`
 * wrote a Postman collection, an OpenAPI document and four other
 * formats from a list of operations the app had made up, and
 * `MemoryExportArtifactWriter` kept them in a `Map`. The Export
 * Center showed a preview with real-looking paths and sizes, and the
 * "Generate" button stored the files in memory and said they were
 * written.
 *
 * Nothing of that touched the user's disk, and the preview it drew
 * had nothing to do with the file the CLI would have produced.
 *
 * ## What it does now
 *
 * It asks the backend for the dry run and for the export. The
 * backend builds the artifacts with the **same exporters** the CLI
 * uses, from the **same snapshot**, and writes them atomically.
 * What the app draws is what was written.
 */
@Injectable({ providedIn: "root" })
export class ExportsClient {
  private readonly bridge = inject(HostBridgeClient);

  /**
   * What would be written, without writing it.
   *
   * One call per format: the backend exports one format at a time,
   * and a preview that merged them would have to guess how two
   * formats share a file name.
   */
  async preview(
    projectRoot: string,
    target: ExportFormat,
    outputDirectory: string,
    workspaceRoot: string,
  ): Promise<ExportDryRun> {
    const answer: DryRunOutput = await this.bridge.request("dry-run", {
      projectRoot,
      target,
      outputDirectory,
    });

    const files: ExportFilePreview[] = answer.files.map((file) => ({
      path: file.path,
      change: file.change,
      bytes: file.bytes,
      overwriteRisk: file.change === "UPDATE",
      outsideWorkspace: !isInside(workspaceRoot, file.path),
    }));

    const diagnostics: ExportDiagnostic[] = answer.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
    }));

    return {
      files,
      diagnostics,
      canGenerate: files.length > 0,
      requiresOverwriteConfirmation: files.some((file) => file.overwriteRisk),
      requiresOutsideWorkspaceConfirmation: files.some((file) => file.outsideWorkspace),
    };
  }
  /** Writes the files, for real. */
  async generate(
    projectRoot: string,
    target: ExportFormat,
    outputDirectory: string,
  ): Promise<ExportResult> {
    const answer: ExportOutput = await this.bridge.request("export", {
      projectRoot,
      target,
      outputDirectory,
    });
    return {
      files: answer.files.map((path) => ({ path })),
      outputDirectory,
    };
  }

  /**
   * What each format can represent.
   *
   * The summaries are the **core's**, not the app's: the app used to
   * carry its own descriptions ("Collection and environment
   * compatible with Postman"), written by hand and never checked
   * against the exporter. The backend says what each one does, and
   * the app shows it.
   */
  async capabilities(projectRoot: string): Promise<ExportCapabilities[]> {
    const answer: DryRunOutput = await this.bridge.request("dry-run", {
      projectRoot,
      target: EXPORT_FORMATS[0],
    });
    return answer.formats.map((format) => ({
      format: format.id as ExportFormat,
      label: format.id,
      summary: format.summary,
    }));
  }
}

/** Whether a path is inside a folder. */
function isInside(root: string, path: string): boolean {
  const normalizedRoot = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(normalizedRoot);
}
