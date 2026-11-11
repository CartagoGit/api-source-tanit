import { beforeEach, describe, expect, test, vi } from "vitest";
import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { DiagnosticsComponent } from "../../packages/app/src/app/features/diagnostics/diagnostics.component";
import { ProjectStore } from "../../packages/app/src/app/core/state/project.store";
import { setLocale } from "../../packages/app/src/app/core/i18n/i18n.state";
import { SnapshotSummarySchema } from "../../packages/contracts/constants/core/application-api.constant";
import type { ISnapshotSummary } from "../../packages/contracts/interfaces/core/application-api.interface";

function summary(total = 1): ISnapshotSummary {
  return SnapshotSummarySchema.parse({
    sessionId: "current", projectRoot: "/project", capturedAt: "2026-11-11T00:00:00Z", frameworks: ["express", "openapi"], endpointCount: total, serviceCount: 1,
    diagnostics: [{ severity: "warning", message: "Recorded warning" }],
    contractEvidence: [{ scope: "static-scan", sources: [{ kind: "documentation", framework: "openapi", serviceId: "api", completeness: "partial", artifacts: ["openapi.json"], limitations: ["Unresolved local reference"] }], operations: Array.from({ length: total }, (_, i) => ({ serviceId: "api", method: "POST", path: `/users/${i}`, status: "conflict", documented: [{ framework: "openapi", file: "openapi.json", line: 0, description: '<img src=x onerror="alert(1)">Original description' }], observed: [{ framework: "express", file: "routes/users.ts", line: 12 }], conflicts: [{ field: "body.name.type", documented: "string", observed: "integer" }], limitations: ["Static assertions only"] })) }],
  });
}

describe("documentation evidence in browser and desktop diagnostics", () => {
  const state = signal<ISnapshotSummary | null>(null);
  beforeEach(() => {
    TestBed.resetTestingModule(); localStorage.clear(); setLocale("en"); state.set(null);
    TestBed.configureTestingModule({ providers: [{ provide: ProjectStore, useValue: { summary: state } }] });
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
    root.querySelector<HTMLButtonElement>(".contracts button")!.click(); fixture.detectChanges();
    expect(root.querySelectorAll(".contract-operation")).toHaveLength(150);
    expect(root.querySelector(".contracts button")).toBeNull();
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
});
