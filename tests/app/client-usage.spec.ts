import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { IClientConsumptionResult } from "../../packages/contracts/interfaces/core/client-consumption.interface";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";
import { ProjectStore } from "../../packages/app/src/app/core/state/project.store";
import { ClientUsageComponent } from "../../packages/app/src/app/features/client-usage/client-usage.component";

const empty: IClientConsumptionResult = {
  usages: [],
  diagnostics: [],
  counts: { resolved: 0, unresolved: 0, matched: 0, missing: 0, ambiguous: 0 },
};

const comparison: IClientConsumptionResult = {
  usages: [
    {
      method: "GET", path: "/items", url: "https://inventory.example.test/items", confidence: "high",
      location: { file: "Items.vue", line: 8, column: 2 },
      evidence: { recognizer: "fetch", callee: "fetch", staticUrl: "literal" },
      correlation: { status: "matched", candidates: [{ method: "GET", uri: "/items" }] },
    },
    {
      method: "POST", path: "/outside", confidence: "medium",
      location: { file: "client.ts", line: 3, column: 0 },
      evidence: { recognizer: "axios", callee: "axios.post", staticUrl: "expression" },
      correlation: { status: "missing", candidates: [] },
    },
    {
      confidence: "low", unresolvedReason: "dynamic-url",
      location: { file: "client.ts", line: 5, column: 0 },
      evidence: { recognizer: "fetch", callee: "fetch" },
      correlation: { status: "unknown", candidates: [] },
    },
    {
      method: "GET", path: "/status", confidence: "high",
      location: { file: "client.ts", line: 9, column: 0 },
      evidence: { recognizer: "fetch", callee: "fetch", staticUrl: "literal" },
      correlation: { status: "ambiguous", candidates: [
        { method: "GET", uri: "/status", serviceId: "primary" },
        { method: "GET", uri: "/status", serviceId: "secondary" },
      ] },
    },
  ],
  diagnostics: [{ file: "Items.vue", reason: "unsupported-template" }],
  counts: { resolved: 3, unresolved: 1, matched: 1, missing: 1, ambiguous: 1 },
  operationsWithoutConfirmedConsumer: [{ method: "DELETE", uri: "/items", serviceId: "inventory" }],
};

describe("client usage report", () => {
  const request = vi.fn();
  const openedRoot = signal<string | null>(null);

  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    openedRoot.set(null);
    request.mockReset();
    TestBed.configureTestingModule({ providers: [
      { provide: HostBridgeClient, useValue: { request } },
      { provide: ProjectStore, useValue: { projectRoot: openedRoot } },
    ] });
  });

  function render() {
    const fixture = TestBed.createComponent(ClientUsageComponent);
    const { i18n } = fixture.componentInstance;
    i18n.setLocale("en");
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const label = (key: string) => i18n.translate(`clientUsage.${key}`);
    const button = (key: string): HTMLButtonElement => {
      const match = Array.from(root.querySelectorAll("button"))
        .find((candidate) => candidate.textContent?.trim() === label(key));
      if (!match) throw new Error(`Could not find "${label(key)}"`);
      return match;
    };
    const click = (key: string) => {
      button(key).click();
      fixture.detectChanges();
    };
    const chooseFolder = (role: "Frontend" | "Backend", path: string) => {
      click(`choose${role}`);
      expect(root.querySelectorAll("tanit-folder-picker")).toHaveLength(1);
      const field = root.querySelector<HTMLInputElement>("tanit-folder-picker input");
      if (!field?.form) throw new Error("Folder picker form unavailable");
      field.value = path;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      fixture.detectChanges();
      field.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      fixture.detectChanges();
      expect(root.querySelector("tanit-folder-picker")).toBeNull();
    };
    return { fixture, root, label, button, click, chooseFolder };
  }

  test("waits for an explicit frontend-only request, disables actions while busy and reports an empty scan", async () => {
    let resolveReport!: (value: IClientConsumptionResult) => void;
    request.mockReturnValue(new Promise(resolve => { resolveReport = resolve; }));
    const { root, fixture, label, button, click, chooseFolder } = render();
    expect(button("analyze").disabled).toBe(true);
    expect(request).not.toHaveBeenCalled();

    chooseFolder("Frontend", "/work/client");
    expect(root.textContent).toContain("/work/client");
    expect(request).not.toHaveBeenCalled();
    click("analyze");
    expect(request).toHaveBeenCalledExactlyOnceWith("client-usage", { projectRoot: "/work/client" });
    expect(root.querySelector('.client-usage[data-state="running"]')).not.toBeNull();
    expect(root.querySelector('[role="status"]')?.textContent).toContain(label("running"));
    expect(button("chooseFrontend").disabled).toBe(true);
    expect(button("chooseBackend").disabled).toBe(true);
    expect(button("analyze").disabled).toBe(true);

    resolveReport(empty);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('.client-usage[data-state="empty"]')).not.toBeNull();
    expect(root.querySelector(".client-usage-results")?.textContent).toContain(label("empty"));
    expect(root.querySelectorAll(".workflow-metrics dt")).toHaveLength(2);
  });

  test("compares only the explicitly selected backend and displays each kind of evidence", async () => {
    openedRoot.set("/work/another-project");
    request.mockResolvedValue(comparison);
    const { root, fixture, label, chooseFolder, click } = render();
    chooseFolder("Frontend", "/work/client");
    chooseFolder("Backend", "/work/server");
    expect(request).not.toHaveBeenCalled();
    click("analyze");
    await fixture.whenStable();
    fixture.detectChanges();

    expect(request).toHaveBeenCalledExactlyOnceWith("client-usage", {
      projectRoot: "/work/client", backendRoot: "/work/server",
    });
    const row = (state: string) => root.querySelector(`.client-usage-row[data-state="${state}"]`)?.textContent;
    expect(root.querySelectorAll(".client-usage-row")).toHaveLength(4);
    expect(row("matched")).toContain("Items.vue:8:3");
    expect(row("matched")).toContain("https://inventory.example.test/items");
    expect(row("matched")).toContain(label("matched"));
    expect(row("missing")).toContain("axios.post");
    expect(row("missing")).toContain(label("missing"));
    expect(row("unknown")).toContain(label("reasons.dynamic-url"));
    expect(row("ambiguous")).toContain("primary");
    expect(row("ambiguous")).toContain("secondary");
    expect(root.querySelector('[aria-labelledby="client-usage-diagnostics"]')?.textContent)
      .toContain(label("reasons.unsupported-template"));
    expect(root.querySelector('[aria-labelledby="client-usage-unconfirmed"]')?.textContent)
      .toContain("DELETE /items");
    expect(Array.from(root.querySelectorAll(".workflow-metrics dd"), node => node.textContent))
      .toEqual(["3", "1", "1", "1", "1"]);

    click("clearBackend");
    expect(root.querySelector(".client-usage-results")).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    click("useOpenBackend");
    expect(root.textContent).toContain("/work/another-project");
    expect(request).toHaveBeenCalledTimes(1);
  });

  test("shows the bridge error and clears it when a root changes", async () => {
    request.mockRejectedValue(new Error("Backend directory unavailable"));
    const { root, fixture, label, chooseFolder, click } = render();
    chooseFolder("Frontend", "/work/client");
    click("analyze");
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector('.client-usage[data-state="error"]')).not.toBeNull();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(label("error"));
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("Backend directory unavailable");
    expect(root.querySelector(".client-usage-results")).toBeNull();
    chooseFolder("Frontend", "/work/other-client");
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.querySelector('.client-usage[data-state="idle"]')).not.toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
