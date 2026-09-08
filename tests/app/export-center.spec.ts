// @vitest-environment jsdom

import "@angular/compiler";
import "zone.js";
import "zone.js/testing";

import { describe, expect, it, vi } from "vitest";
import { getTestBed, TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";

import { EXPORT_FORMATS, ExportsClient, MemoryExportArtifactWriter } from "../../packages/app/src/app/core/api/exports.client";
import { ExportsStore } from "../../packages/app/src/app/core/state/exports.store";
import { DialogService } from "../../packages/app/src/app/core/host/dialog.service";
import { ExportCenterComponent } from "../../packages/app/src/app/features/exports/export-center.component";
import { ExportPreviewComponent } from "../../packages/app/src/app/features/exports/export-preview.component";
import { ExportSummaryComponent } from "../../packages/app/src/app/features/exports/export-summary.component";
import { FormatCapabilitiesComponent } from "../../packages/app/src/app/features/exports/format-capabilities.component";

getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

describe("Export Center", () => {
  it("lists every format with real counts and marks lossy exports", () => {
    const client = new ExportsClient();
    const capabilities = client.capabilities(42);
    expect(capabilities.map((item) => item.format)).toEqual([...EXPORT_FORMATS]);
    expect(capabilities.every((item) => item.counts.operations === 42)).toBe(true);
    expect(capabilities.find((item) => item.format === "postman")?.lossy).toBe(false);
    expect(capabilities.find((item) => item.format === "curl")?.lossy).toBe(true);
  });

  it("reports NEW, UPDATE, outside-workspace and structured diagnostics in dry-run", () => {
    const client = new ExportsClient();
    const fresh = client.dryRun({ formats: ["postman"], outputDirectory: "/workspace/out", workspaceRoot: "/workspace", endpointCount: 1 });
    expect(fresh.files[0]?.change).toBe("NEW");
    const content = client.dryRun({ formats: ["postman"], outputDirectory: "/workspace/existing", workspaceRoot: "/workspace", endpointCount: 1 }).files[0]!.content;
    const unchanged = client.dryRun({ formats: ["postman"], outputDirectory: "/workspace/existing", workspaceRoot: "/workspace", endpointCount: 1, existingFiles: [{ path: "/workspace/existing/tanit-postman.json", content }] });
    expect(unchanged.files[0]?.change).toBe("UNCHANGED");
    const existing = client.dryRun({ formats: ["postman"], outputDirectory: "/workspace/existing", workspaceRoot: "/workspace", endpointCount: 1, existingFiles: [{ path: "/workspace/existing/tanit-postman.json", content: "stale" }] });
    expect(existing.files[0]?.change).toBe("UPDATE");
    expect(existing.canGenerate).toBe(false);
    const outside = client.dryRun({ formats: ["postman"], outputDirectory: "/workspace-evil/out", workspaceRoot: "/workspace", endpointCount: 0 });
    expect(outside.requiresOutsideWorkspaceConfirmation).toBe(true);
    expect(outside.diagnostics[0]).toMatchObject({ code: "NO_ENDPOINTS", severity: "error", operationIds: [] });
  });

  it("enforces overwrite and outside-workspace confirmations", async () => {
    const client = new ExportsClient();
    await expect(client.generate({ formats: ["postman"], outputDirectory: "/workspace/existing", workspaceRoot: "/workspace", endpointCount: 1, existingFiles: [{ path: "/workspace/existing/tanit-postman.json", content: "stale" }] })).rejects.toThrow();
    const result = await client.generate({ formats: ["postman"], outputDirectory: "/tmp/out", workspaceRoot: "/workspace", endpointCount: 1, overwriteConfirmed: true, outsideWorkspaceConfirmed: true });
    expect(result.outputDirectory).toBe("/tmp/out");
  });

  it("feeds operations and existing files into the UI dry-run", () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ExportsClient, ExportsStore] });
    const store = TestBed.inject(ExportsStore);
    store.setOutputDirectory("/workspace/out");
    store.setOperations([{ id: "operation-1", method: "GET", path: "/users" }]);
    const content = store.preview().files[0]!.content;
    store.setExistingFiles([{ path: "/workspace/out/tanit-postman.json", content }]);
    expect(store.preview().files[0]?.change).toBe("UNCHANGED");
    store.setExistingFiles([{ path: "/workspace/out/tanit-postman.json", content: "stale" }]);
    expect(store.preview().files[0]?.change).toBe("UPDATE");
  });

  it("generates verifiable content for every supported format", async () => {
    const writer = new MemoryExportArtifactWriter();
    const client = new ExportsClient(writer);
    const result = await client.generate({ formats: [...EXPORT_FORMATS], outputDirectory: "/workspace/out", workspaceRoot: "/workspace", endpointCount: 1 });
    expect(result.files).toHaveLength(EXPORT_FORMATS.length);
    expect(writer.written.get("/workspace/out/tanit-openapi.json")).toContain('"openapi": "3.1.0"');
    expect(writer.written.get("/workspace/out/tanit-postman.json")).toContain("operation-1");
    expect(writer.written.get("/workspace/out/tanit-curl.sh")).toContain("curl -X GET");
    expect(writer.written.get("/workspace/out/tanit-har.json")).toContain('"version": "1.2"');
    expect(writer.written.get("/workspace/out/tanit-insomnia.json")).toContain('"__export_format": 4');
    expect(writer.written.get("/workspace/out/tanit-bruno.json")).toContain('"requests"');
  });

  it("preserves operation diagnostics and supports several diagnostics", () => {
    const client = new ExportsClient();
    const dryRun = client.dryRun({ formats: ["postman"], outputDirectory: "/workspace/out", workspaceRoot: "/workspace", endpointCount: 2, operations: [{ id: "one", method: "GET", path: "/one", diagnostics: [{ code: "AUTH_MISSING", severity: "warning", operationIds: ["one"], message: "Auth is incomplete.", suggestion: "Configure authentication." }] }, { id: "two", method: "POST", path: "/two", diagnostics: [{ code: "SCHEMA_PARTIAL", severity: "info", operationIds: ["two"], message: "Schema is partial.", suggestion: "Review the response schema." }] }] });
    expect(dryRun.diagnostics.map((item) => item.code)).toEqual(["AUTH_MISSING", "SCHEMA_PARTIAL"]);
  });

  it("renders the components and exposes success actions", async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [ExportCenterComponent, ExportPreviewComponent, ExportSummaryComponent, FormatCapabilitiesComponent], providers: [ExportsClient, ExportsStore, { provide: DialogService, useValue: { pickFolder: vi.fn().mockResolvedValue("/tmp/export") } }] });
    const capabilities = TestBed.createComponent(FormatCapabilitiesComponent);
    capabilities.componentRef.setInput("capabilities", new ExportsClient().capabilities(12));
    capabilities.detectChanges();
    expect(capabilities.nativeElement.textContent).toContain("Postman");
    const center = TestBed.runInInjectionContext(() => new ExportCenterComponent());
    center.toggleFormat("openapi");
    expect(center.store.formats()).toContain("openapi");
    await center.chooseOutput();
    expect(center.store.outputDirectory()).toBe("/tmp/export");
    capabilities.destroy();
  });

  it("allows diagnostic filtering and copies generated paths", async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [ExportCenterComponent, ExportPreviewComponent, ExportSummaryComponent, FormatCapabilitiesComponent], providers: [ExportsClient, ExportsStore, DialogService] });
    const center = TestBed.runInInjectionContext(() => new ExportCenterComponent());
    center.store.setEndpointCount(0);
    center.selectDiagnostic(center.store.diagnostics()[0]!);
    expect(window.location.search).toContain("diagnosticCode=NO_ENDPOINTS");
    const writeText = vi.fn(); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await center.copyPaths(["/workspace/out/postman.json"]);
    expect(writeText).toHaveBeenCalledWith("/workspace/out/postman.json");
  });
});