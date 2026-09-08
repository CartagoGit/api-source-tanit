import { Injectable } from "@angular/core";

export const EXPORT_FORMATS = ["postman", "openapi", "insomnia", "bruno", "har", "curl"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
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

export interface ExportDryRun {
  readonly files: readonly ExportFilePreview[];
  readonly diagnostics: readonly ExportDiagnostic[];
  readonly canGenerate: boolean;
  readonly requiresOverwriteConfirmation: boolean;
  readonly requiresOutsideWorkspaceConfirmation: boolean;
  readonly combinedExport?: CombinedExportStatus;
}

export interface CombinedExportStatus {
  readonly partial: boolean;
  readonly explanation: string;
  readonly services: ReadonlyArray<{ readonly serviceId: string; readonly reason: string }>;
  readonly operationRefs: Readonly<Record<string, { readonly serverRef?: string; readonly authRef?: string }>>;
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

export interface ExportResult {
  readonly files: readonly ExportFilePreview[];
  readonly outputDirectory: string;
  readonly postmanInstalled: boolean;
}

export interface ExportArtifactWriter {
  write(path: string, content: string): Promise<void>;
}

export class MemoryExportArtifactWriter implements ExportArtifactWriter {
  readonly written = new Map<string, string>();

  async write(path: string, content: string): Promise<void> {
    this.written.set(path, content);
  }
}

const FORMAT_DETAILS: Readonly<Record<ExportFormat, Omit<ExportCapabilities, "format">>> = {
  postman: { label: "Postman", supported: true, lossy: false, counts: { collections: 1, operations: 0 }, note: "Collection and environment compatible with Postman." },
  openapi: { label: "OpenAPI 3.1", supported: true, lossy: false, counts: { documents: 1, operations: 0 }, note: "Canonical HTTP contract with schemas and responses." },
  insomnia: { label: "Insomnia v4", supported: true, lossy: true, counts: { exports: 1, operations: 0 }, note: "HTTP operations preserved; non-HTTP transports may be partial." },
  bruno: { label: "Bruno", supported: true, lossy: true, counts: { collections: 1, operations: 0 }, note: "Folder collection; generated requests preserve HTTP details." },
  har: { label: "HAR", supported: true, lossy: true, counts: { archives: 1, operations: 0 }, note: "Network archive; auth metadata can be lossy." },
  curl: { label: "cURL", supported: true, lossy: true, counts: { scripts: 1, operations: 0 }, note: "One shell command per HTTP operation." },
};

@Injectable({ providedIn: "root" })
export class ExportsClient {
  constructor(private readonly artifactWriter: ExportArtifactWriter = new MemoryExportArtifactWriter()) {}

  capabilities(endpointCount: number): readonly ExportCapabilities[] {
    return EXPORT_FORMATS.map((format) => ({ format, ...FORMAT_DETAILS[format], counts: { ...FORMAT_DETAILS[format].counts, operations: endpointCount } }));
  }

  dryRun(request: ExportRequest): ExportDryRun {
    const operations = request.operations ?? createOperations(request.endpointCount);
    const files = request.formats.map((format) => {
      const path = joinPath(request.outputDirectory, `tanit-${format}.${format === "curl" ? "sh" : format === "bruno" ? "bru" : "json"}`);
      const content = renderArtifact(format, operations);
      const existing = request.existingFiles?.find((file) => normalizePath(file.path) === normalizePath(path));
      const outsideWorkspace = !isContainedPath(request.workspaceRoot, request.outputDirectory);
      const change: ExportChange = existing === undefined ? "NEW" : existing.content === content ? "UNCHANGED" : "UPDATE";
      return { path, change, overwriteRisk: change === "UPDATE", outsideWorkspace, content };
    });
    const diagnostics: ExportDiagnostic[] = request.endpointCount === 0 ? [{
      code: "NO_ENDPOINTS",
      severity: "error",
      operationIds: [],
      message: "No endpoints are available for export.",
      suggestion: "Scan the project or adjust the endpoint filters before generating.",
    }] : operations.flatMap((operation) => operation.diagnostics ?? []);
    const requiresOverwriteConfirmation = files.some((file) => file.overwriteRisk) && request.overwriteConfirmed !== true;
    const requiresOutsideWorkspaceConfirmation = files.some((file) => file.outsideWorkspace) && request.outsideWorkspaceConfirmed !== true;
    const combinedExport = request.combinedExport;
    const partialDiagnostic = combinedExport?.partial ? {
      code: "COMBINED_EXPORT_PARTIAL",
      severity: "warning" as const,
      operationIds: Object.keys(combinedExport.operationRefs),
      message: combinedExport.explanation,
      suggestion: "Export each affected service separately to preserve its server and auth references.",
    } : null;
    return { files, diagnostics: partialDiagnostic ? [...diagnostics, partialDiagnostic] : diagnostics, canGenerate: diagnostics.every((item) => item.severity !== "error") && !requiresOverwriteConfirmation && !requiresOutsideWorkspaceConfirmation, requiresOverwriteConfirmation, requiresOutsideWorkspaceConfirmation, combinedExport };
  }

  generate(request: ExportRequest): Promise<ExportResult> {
    const preview = this.dryRun(request);
    if (!preview.canGenerate) return Promise.reject(new Error("Export confirmation is required before generating."));
    return Promise.all(preview.files.map((file) => this.artifactWriter.write(file.path, file.content))).then(() => ({ files: preview.files, outputDirectory: request.outputDirectory, postmanInstalled: false }));
  }
}

function createOperations(endpointCount: number): readonly ExportOperation[] {
  return Array.from({ length: Math.max(0, endpointCount) }, (_, index) => ({ id: `operation-${index + 1}`, method: "GET", path: `/operation-${index + 1}` }));
}

function normalizePath(value: string): string {
  const segments: string[] = [];
  for (const segment of value.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop(); else segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

function joinPath(directory: string, filename: string): string {
  return `${normalizePath(directory)}/${filename}`;
}

function isContainedPath(workspaceRoot: string, candidate: string): boolean {
  const root = normalizePath(workspaceRoot);
  const path = normalizePath(candidate);
  return path === root || path.startsWith(`${root}/`);
}

function renderArtifact(format: ExportFormat, operations: readonly ExportOperation[]): string {
  if (format === "curl") return operations.map((operation) => `curl -X ${operation.method} "http://localhost${operation.path}"`).join("\n");
  if (format === "har") return JSON.stringify({ log: { version: "1.2", entries: operations.map((operation) => ({ request: { method: operation.method, url: `http://localhost${operation.path}` } })) } }, null, 2);
  if (format === "openapi") return JSON.stringify({ openapi: "3.1.0", info: { title: "Tanit export", version: "1.0.0" }, paths: Object.fromEntries(operations.map((operation) => [operation.path, { [operation.method.toLowerCase()]: { operationId: operation.id, responses: { "200": { description: "Success" } } } }])) }, null, 2);
  if (format === "postman") return JSON.stringify({ info: { name: "Tanit export", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: operations.map((operation) => ({ name: operation.id, request: { method: operation.method, url: `http://localhost${operation.path}` } })) }, null, 2);
  if (format === "insomnia") return JSON.stringify({ _type: "export", __export_format: 4, resources: operations.map((operation) => ({ _type: "request", name: operation.id, method: operation.method, url: `http://localhost${operation.path}` })) }, null, 2);
  return operations.map((operation) => `meta {
  name: ${operation.id}
  type: http
  seq: ${operations.indexOf(operation) + 1}
}

get {
  url: http://localhost${operation.path}
  body: none
  auth: none
}`).join("\n\n");
}