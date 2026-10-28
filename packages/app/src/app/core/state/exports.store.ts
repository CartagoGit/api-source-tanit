import { Injectable, computed, inject, signal } from "@angular/core";

import { EXPORT_FORMATS, CombinedExportStatus, ExportCapabilities, ExportDiagnostic, ExportDryRun, ExportExistingFile, ExportFormat, ExportOperation, ExportResult, ExportRequest, ExportsClient } from "../api/exports.client";

@Injectable({ providedIn: "root" })
export class ExportsStore {
  private readonly client = inject(ExportsClient);
  readonly formats = signal<readonly ExportFormat[]>(["postman"]);
  readonly outputDirectory = signal("/workspace/exports");
  readonly workspaceRoot = signal("/workspace");
  readonly endpointCount = signal(12);
  readonly operations = signal<readonly ExportOperation[]>([]);
  readonly existingFiles = signal<readonly ExportExistingFile[]>([]);
  readonly combinedExport = signal<CombinedExportStatus | undefined>(undefined);
  readonly overwriteConfirmed = signal(false);
  readonly outsideWorkspaceConfirmed = signal(false);
  readonly capabilities = computed<readonly ExportCapabilities[]>(() => this.client.capabilities(this.endpointCount()));
  readonly preview = computed<ExportDryRun>(() => this.client.dryRun(this.request()));
  readonly diagnostics = computed<readonly ExportDiagnostic[]>(() => this.preview().diagnostics);
  readonly result = signal<ExportResult | null>(null);
  readonly error = signal<string | null>(null);

  toggleFormat(format: ExportFormat): void {
    const selected = new Set(this.formats());
    if (selected.has(format)) selected.delete(format); else selected.add(format);
    this.formats.set(EXPORT_FORMATS.filter((item) => selected.has(item)));
    this.result.set(null);
  }
  setOutputDirectory(path: string): void { this.outputDirectory.set(path); this.outsideWorkspaceConfirmed.set(false); this.result.set(null); }
  confirmOverwrite(value: boolean): void { this.overwriteConfirmed.set(value); }
  confirmOutsideWorkspace(value: boolean): void { this.outsideWorkspaceConfirmed.set(value); }
  setEndpointCount(count: number): void { this.endpointCount.set(count); }
  setOperations(operations: readonly ExportOperation[]): void { this.operations.set(operations); this.endpointCount.set(operations.length); this.result.set(null); }
  setExistingFiles(files: readonly ExportExistingFile[]): void { this.existingFiles.set(files); this.overwriteConfirmed.set(false); this.result.set(null); }
  setCombinedExport(status: CombinedExportStatus | undefined): void { this.combinedExport.set(status); this.result.set(null); }
  async generate(): Promise<void> {
    this.error.set(null);
    try { this.result.set(await this.client.generate(this.request())); } catch (error) { this.error.set((error as Error).message); }
  }
  private request(): ExportRequest { return { formats: this.formats(), outputDirectory: this.outputDirectory(), workspaceRoot: this.workspaceRoot(), endpointCount: this.endpointCount(), operations: this.operations(), existingFiles: this.existingFiles(), combinedExport: this.combinedExport(), overwriteConfirmed: this.overwriteConfirmed(), outsideWorkspaceConfirmed: this.outsideWorkspaceConfirmed() }; }
}