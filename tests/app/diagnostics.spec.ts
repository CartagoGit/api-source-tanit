import { beforeEach, describe, expect, test, vi } from "vitest";
import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { DiagnosticsComponent } from "../../packages/app/src/app/features/diagnostics/diagnostics.component";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";
import { ProjectStore } from "../../packages/app/src/app/core/state/project.store";
import { setLocale } from "../../packages/app/src/app/core/i18n/i18n.state";
import { SnapshotSummarySchema } from "../../packages/contracts/constants/core/application-api.constant";
import type { ISnapshotSummary } from "../../packages/contracts/interfaces/core/application-api.interface";

function summary(total = 1): ISnapshotSummary {
  return SnapshotSummarySchema.parse({
    sessionId: "current", projectRoot: "/project", capturedAt: "2026-11-11T00:00:00Z", frameworks: ["express", "openapi"], endpointCount: total, serviceCount: 1,
    diagnostics: [{ severity: "warning", message: "Recorded warning" }],
    contractEvidence: [{ scope: "static-scan", sources: [{ kind: "documentation", framework: "openapi", serviceId: "api", completeness: "partial", artifacts: ["openapi.json"], limitations: ["Unresolved local reference"] }], operations: Array.from({ length: total }, (_, i) => ({ serviceId: "api", method: "POST", path: `/users/${i}`, status: "conflict", documented: [{ framework: "openapi", file: "openapi.json", line: 0, pointer: `#/paths/~1users~1${i}/post`, description: '<img src=x onerror="alert(1)">Original description' }], observed: [{ framework: "express", file: "routes/users.ts", line: 12 }], conflicts: [{ field: "body.name.type", documented: "string", observed: "integer" }], limitations: ["Static assertions only"] })) }],
  });
}

describe("documentation evidence in browser and desktop diagnostics", () => {
  const state = signal<ISnapshotSummary | null>(null);
  const request = vi.fn();
  beforeEach(() => {
    TestBed.resetTestingModule(); localStorage.clear(); setLocale("en"); state.set(null);
    request.mockReset();
    TestBed.configureTestingModule({ providers: [
      { provide: ProjectStore, useValue: { summary: state } },
      { provide: HostBridgeClient, useValue: { request } },
    ] });
  });
  test("renders recorded contradictions, origins and localized severity safely without network calls", () => {
    state.set(summary());
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected external request"));
    try {
      const fixture = TestBed.createComponent(DiagnosticsComponent); fixture.componentInstance.i18n.setLocale("es"); fixture.detectChanges();
      const root: HTMLElement = fixture.nativeElement;
      expect(root.textContent).toContain("Documentación y código");
      expect(root.textContent).toContain("Aviso");
      expect(root.textContent).not.toContain('i18n.translate(');
      expect(root.textContent).toContain("Afirmaciones en conflicto");
      expect(root.textContent).toContain("openapi.json");
      expect(root.textContent).toContain("#/paths/~1users~10/post");
      expect(root.textContent).toContain("routes/users.ts");
      expect(root.textContent).toContain("body.name.type");
      expect(root.textContent).toContain("string"); expect(root.textContent).toContain("integer");
      expect(root.textContent).toContain('<img src=x onerror="alert(1)">');
      expect(root.querySelector("img")).toBeNull(); expect(root.querySelector("script")).toBeNull();
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
  test("bounds initial rendering and lets the user reveal the next page", () => {
    state.set(summary(150));
    const fixture = TestBed.createComponent(DiagnosticsComponent); fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelectorAll(".contract-operation")).toHaveLength(100);
    root.querySelector<HTMLButtonElement>(".contract-page-next")!.click(); fixture.detectChanges();
    expect(root.querySelectorAll(".contract-operation")).toHaveLength(150);
    expect(root.querySelector(".contract-page-next")).toBeNull();
  });
  test("keeps unknown distinct, filters matches and clears data when the project closes", () => {
    const data = summary(2); const report = data.contractEvidence![0]!;
    report.operations[0]!.status = "unknown"; report.operations[0]!.conflicts = [];
    report.operations[1]!.status = "matched"; report.operations[1]!.conflicts = [];
    state.set(data);
    const fixture = TestBed.createComponent(DiagnosticsComponent); fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelectorAll(".contract-operation")).toHaveLength(1);
    expect(root.textContent).toContain("Counterpart unknown");
    root.querySelector<HTMLInputElement>(".contract-filter input")!.click(); fixture.detectChanges();
    expect(root.querySelectorAll(".contract-operation")).toHaveLength(2);
    state.set(null); fixture.detectChanges();
    expect(root.querySelector(".contracts")).toBeNull(); expect(root.textContent).not.toContain("openapi.json");
  });
  test("opens a listed document on demand and renders its markup as plain text", async () => {
    state.set(summary());
    const literal = '<script>original document</script>';
    request.mockResolvedValue({ text: literal });
    const fixture = TestBed.createComponent(DiagnosticsComponent);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(request).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>(".artifact-open")!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(request).toHaveBeenCalledWith("read-contract-artifact", {
      projectRoot: "/project", sessionId: "current", serviceId: "api", artifact: "openapi.json",
    });
    expect(root.querySelector(".artifact-preview pre")?.textContent).toBe(literal);
    expect(root.querySelector("script")).toBeNull();
    state.set(null);
    fixture.detectChanges();
    expect(root.querySelector(".artifact-preview")).toBeNull();
  });

  test("discards a document response after the snapshot changes", async () => {
    state.set(summary());
    let resolvePreview!: (value: { text: string }) => void;
    request.mockReturnValue(new Promise(resolve => { resolvePreview = resolve; }));
    const fixture = TestBed.createComponent(DiagnosticsComponent);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    root.querySelector<HTMLButtonElement>(".artifact-open")!.click();
    state.set(summary());
    resolvePreview({ text: "previous snapshot" });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector(".artifact-preview")).toBeNull();
  });

  test("opens a remote link only on request and keeps the static report if it fails", async () => {
    const data = summary();
    const url = "https://docs.example.invalid/openapi.json";
    data.contractEvidence![0]!.sources[0]!.links = [{ url, file: "openapi.json", pointer: "#/externalDocs/url" }];
    state.set(data);
    request.mockRejectedValue(new Error("Unavailable"));
    const fixture = TestBed.createComponent(DiagnosticsComponent);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector("a[href]")).toBeNull();
    expect(request).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>(".remote-artifact-open")!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(request).toHaveBeenCalledWith("read-remote-contract", {
      projectRoot: "/project", sessionId: "current", serviceId: "api", url,
    });
    expect(root.querySelector(".artifact-preview [role=alert]")?.textContent).toContain("scan report");
    expect(root.querySelector(".contract-operation")).not.toBeNull();
  });
});
