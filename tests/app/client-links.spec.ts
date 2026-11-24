import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  ClientProjectCandidates,
  IClientProjectLinksReport,
  IJsonRequestCheck,
  IJsonResponseCheck,
} from "../../packages/contracts/interfaces/core/client-consumption.interface";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";
import { ClientContractEvidenceComponent } from "../../packages/app/src/app/features/client-usage/client-contract-evidence.component";
import { ClientLinksComponent } from "../../packages/app/src/app/features/client-usage/client-links.component";

const frontends = {
  role: "frontend",
  root: "/workspace",
  projects: [
    { root: "/workspace/storefront", relativePath: "storefront" },
    { root: "/workspace/admin", relativePath: "admin" },
  ],
} satisfies ClientProjectCandidates;

function backend(root: string, serviceId: string): ClientProjectCandidates {
  return {
    role: "backend", root,
    services: [{ serviceId, relativePath: "", framework: "openapi", httpOperationCount: 3 }],
  };
}

const catalog: IClientProjectLinksReport["frontends"][number]["backends"][number] = {
  id: "opaque-catalog-id", root: "/catalog", serviceId: "catalog",
  operationsWithoutConfirmedConsumer: [{ method: "DELETE", uri: "/items" }],
};
const orders: IClientProjectLinksReport["frontends"][number]["backends"][number] = {
  id: "opaque-orders-id", root: "/orders", serviceId: "orders",
  operationsWithoutConfirmedConsumer: [],
};
const usage = {
  method: "GET", url: "https://catalog.example/items", path: "/items", confidence: "high",
  evidence: { recognizer: "fetch", callee: "fetch" },
  location: { file: "View.vue", line: 7, column: 3 },
} as const;
const report: IClientProjectLinksReport = {
  frontends: [
    {
      root: "/workspace/storefront",
      diagnostics: [{ file: "View.vue", reason: "unsupported-template" }],
      calls: [
        { usage, status: "matched", backendId: catalog.id, candidates: [] },
        {
          usage, status: "ambiguous", candidates: [
            { backendId: catalog.id, operation: { method: "GET", uri: "/items" } },
            { backendId: orders.id, operation: { method: "GET", uri: "/items" } },
          ],
        },
      ],
      backends: [catalog, orders],
    },
    {
      root: "/workspace/admin", diagnostics: [],
      calls: [
        { usage: { ...usage, path: "/not-in-catalog" }, status: "missing", candidates: [] },
        {
          usage: { ...usage, url: undefined, path: undefined, unresolvedReason: "dynamic-url" },
          status: "unknown", candidates: [],
        },
      ],
      backends: [catalog],
    },
  ],
};

describe("workspace client usage", () => {
  const request = vi.fn();

  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    request.mockReset();
    TestBed.configureTestingModule({ providers: [{ provide: HostBridgeClient, useValue: { request } }] });
  });

  function render() {
    const fixture = TestBed.createComponent(ClientLinksComponent);
    fixture.componentInstance.i18n.setLocale("en");
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    function button(selector: string): HTMLButtonElement {
      const match = root.querySelector<HTMLButtonElement>(selector);
      if (!match) throw new Error(`No button for ${selector}`);
      return match;
    }
    function submitFolder(role: "frontend" | "backend", path: string) {
      button(`.client-links-choose-${role}`).click();
      fixture.detectChanges();
      const field = root.querySelector<HTMLInputElement>("tanit-folder-picker input");
      if (!field?.form) throw new Error("No folder picker");
      field.value = path;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      fixture.detectChanges();
      field.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      fixture.detectChanges();
    }
    async function settle() {
      await fixture.whenStable();
      fixture.detectChanges();
    }
    function selectCandidate(text: string) {
      const label = Array.from(root.querySelectorAll("label"))
        .find(element => element.textContent?.includes(text) && element.querySelector('input[type="checkbox"]'));
      const checkbox = label?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (!checkbox) throw new Error(`No candidate for ${text}`);
      checkbox.click();
      fixture.detectChanges();
    }
    function setOption(role: "frontend" | "backend", text: string) {
      const select = root.querySelector<HTMLSelectElement>(`#client-links-${role}`);
      const option = select && Array.from(select.options).find(item => item.value && item.text.includes(text));
      if (!select || !option) throw new Error(`No link option for ${text}`);
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      fixture.detectChanges();
    }
    function addLink(frontend: string, backend: string) {
      setOption("frontend", frontend);
      setOption("backend", backend);
      expect(button(".client-links-add").disabled).toBe(false);
      button(".client-links-add").click();
      fixture.detectChanges();
      expect(button(".client-links-add").disabled).toBe(true);
    }
    return { root, fixture, button, submitFolder, settle, selectCandidate, addLink };
  }

  test("submits only explicit links and renders the returned evidence per frontend", async () => {
    request.mockResolvedValueOnce(frontends)
      .mockResolvedValueOnce(backend("/catalog", "catalog"))
      .mockResolvedValueOnce(backend("/orders", "orders"))
      .mockResolvedValueOnce(report);
    const { root, fixture, button, submitFolder, settle, selectCandidate, addLink } = render();

    expect(button(".client-links-analyze").disabled).toBe(true);
    expect(request).not.toHaveBeenCalled();
    submitFolder("frontend", "/workspace");
    await settle();
    selectCandidate("storefront");
    selectCandidate("admin");
    submitFolder("backend", "/catalog");
    await settle();
    selectCandidate("catalog");
    submitFolder("backend", "/orders");
    await settle();
    selectCandidate("orders");
    expect(root.querySelectorAll(".client-links-selection-row")).toHaveLength(0);

    addLink("storefront", "catalog");
    addLink("storefront", "orders");
    addLink("admin", "catalog");
    expect(root.querySelectorAll(".client-links-selection-row")).toHaveLength(3);
    button(".client-links-analyze").click();
    await settle();

    expect(request.mock.calls).toEqual([
      ["client-candidates", { role: "frontend", projectRoot: "/workspace" }],
      ["client-candidates", { role: "backend", projectRoot: "/catalog" }],
      ["client-candidates", { role: "backend", projectRoot: "/orders" }],
      ["client-links", {
        frontends: [{ root: "/workspace/storefront" }, { root: "/workspace/admin" }],
        links: [
          { frontendRoot: "/workspace/storefront", backendRoot: "/catalog", serviceId: "catalog" },
          { frontendRoot: "/workspace/storefront", backendRoot: "/orders", serviceId: "orders" },
          { frontendRoot: "/workspace/admin", backendRoot: "/catalog", serviceId: "catalog" },
        ],
      }],
    ]);
    const results = root.querySelector(".client-links-results");
    expect(results?.querySelectorAll(".client-links-frontend-report")).toHaveLength(2);
    expect(Array.from(results?.querySelectorAll(".client-links-call") ?? [], item => item.getAttribute("data-state")))
      .toEqual(["matched", "ambiguous", "missing", "unknown"]);
    expect(results?.textContent).toContain("View.vue:7:4");
    expect(results?.textContent).toContain("https://catalog.example/items");
    const unconfirmed = results?.querySelector('.client-links-operation:has([data-method="DELETE"])');
    expect(unconfirmed?.querySelector('[data-method="DELETE"]')?.textContent).toContain("DELETE");
    expect(unconfirmed?.querySelector("code")?.textContent).toContain("/items");
    expect(results?.textContent).toContain(fixture.componentInstance.i18n.translate("clientUsage.reasons.unsupported-template"));
    expect(results?.textContent).toContain(fixture.componentInstance.i18n.translate("clientUsage.reasons.dynamic-url"));
    expect(results?.querySelector('.client-links-call[data-state="ambiguous"] .client-links-candidates')?.textContent)
      .toContain("orders · /orders");
    expect(results?.textContent).not.toContain("opaque-catalog-id");

    button(".client-links-selection-row button").click();
    await settle();
    expect(root.querySelectorAll(".client-links-selection-row")).toHaveLength(2);
    expect(root.querySelector(".client-links-results")).toBeNull();
    selectCandidate("orders");
    expect(root.querySelectorAll(".client-links-selection-row")).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(4);

  });


  test("opts into contract checks and shows request and response evidence independently", async () => {
    const requestPointer = "#/paths/~1items/post/requestBody/content/application~1json/schema";
    const responsePointer = "#/paths/~1items/post/responses/200/content/application~1json/schema";
    const compared: IClientProjectLinksReport = {
      frontends: [{
        root: "/workspace/storefront",
        diagnostics: [],
        backends: [catalog],
        calls: [{
          usage: { ...usage, method: "POST" },
          status: "matched",
          backendId: catalog.id,
          candidates: [{ backendId: catalog.id, operation: { method: "POST", uri: "/items" } }],
          requestContract: {
            verdict: "incompatible", reason: "missing-field", field: "displayName",
            source: { file: "request.openapi.yaml", pointer: requestPointer },
          },
          responseContract: {
            verdict: "unknown", reason: "unsupported-schema", status: 200,
            source: { file: "response.openapi.yaml", pointer: responsePointer },
          },
        }],
      }],
    };
    request.mockResolvedValueOnce(frontends)
      .mockResolvedValueOnce(backend("/catalog", "catalog"))
      .mockResolvedValueOnce(compared);
    const { root, fixture, button, submitFolder, settle, selectCandidate, addLink } = render();
    const requestCheck = root.querySelector<HTMLInputElement>("#client-links-check-request");
    const responseCheck = root.querySelector<HTMLInputElement>("#client-links-check-response");
    if (!requestCheck || !responseCheck) throw new Error("Missing contract checkboxes");
    for (const check of [requestCheck, responseCheck]) {
      expect(check.type).toBe("checkbox");
      expect(check.checked).toBe(false);
      expect(check.disabled).toBe(true);
    }

    submitFolder("frontend", "/workspace");
    await settle();
    selectCandidate("storefront");
    submitFolder("backend", "/catalog");
    await settle();
    selectCandidate("catalog");
    addLink("storefront", "catalog");
    for (const check of [requestCheck, responseCheck]) {
      expect(check.disabled).toBe(false);
      check.click();
      fixture.detectChanges();
      expect(check.checked).toBe(true);
    }
    button(".client-links-analyze").click();
    await settle();

    expect(request).toHaveBeenLastCalledWith("client-links", {
      frontends: [{ root: "/workspace/storefront" }],
      links: [{ frontendRoot: "/workspace/storefront", backendRoot: "/catalog", serviceId: "catalog" }],
      compareRequestBodies: true,
      compareResponseBodies: true,
    });
    const evidence = root.querySelector('.client-links-call[data-state="matched"] tanit-client-contract-evidence details');
    expect(evidence?.querySelector("summary")).toBeTruthy();
    const requestRow = evidence?.querySelector('[data-direction="request"][data-verdict="incompatible"]');
    expect(requestRow?.textContent).toContain("displayName");
    expect(requestRow?.textContent).toContain("request.openapi.yaml");
    expect(requestRow?.textContent).toContain(requestPointer);
    const responseRow = evidence?.querySelector('[data-direction="response"][data-verdict="unknown"]');
    expect(responseRow?.textContent).toContain("response.openapi.yaml");
    expect(responseRow?.textContent).toContain(responsePointer);
    expect(responseRow?.textContent?.replace(responsePointer, "")).toContain("200");
  });

  test("localizes all analyzer reasons and preserves directions in the contract details", () => {
    const fixture = TestBed.createComponent(ClientContractEvidenceComponent);
    const root: HTMLElement = fixture.nativeElement;
    const requests = [
      { verdict: "unknown", reason: "invalid-json" },
      { verdict: "incompatible", reason: "missing-field" },
      { verdict: "incompatible", reason: "unexpected-field" },
      { verdict: "incompatible", reason: "type-mismatch" },
      { verdict: "incompatible", reason: "enum-mismatch" },
      { verdict: "unknown", reason: "unsupported-json" },
      { verdict: "unknown", reason: "missing-client-json" },
    ] satisfies IJsonRequestCheck[];
    const responses = [
      { verdict: "unknown", reason: "missing-backend-schema" },
      { verdict: "unknown", reason: "missing-client-type" },
      { verdict: "incompatible", reason: "optional-field" },
      { verdict: "unknown", reason: "unsupported-schema" },
      { verdict: "compatible" },
    ] satisfies IJsonResponseCheck[];
    for (const locale of ["en", "es", "fr"] as const) {
      fixture.componentInstance.i18n.setLocale(locale);
      for (const [direction, samples] of [["request", requests], ["response", responses]] as const) {
        for (const sample of samples) {
          fixture.componentRef.setInput(direction, sample);
          fixture.detectChanges();
          const row = root.querySelector(`[data-direction="${direction}"][data-verdict="${sample.verdict}"]`);
          expect(row).toBeTruthy();
          expect(row?.textContent).not.toContain("clientContract.");
          if ("reason" in sample) {
            expect(row?.textContent).toContain(fixture.componentInstance.i18n.translate(`clientContract.reason.${sample.reason}`));
            expect(row?.querySelector(".contract-advice")?.textContent?.trim()).toBeTruthy();
          } else {
            expect(row?.querySelector(".contract-advice")).toBeNull();
          }
        }
      }
    }
  });

  test("shows discovery and analysis errors and allows a frontend-only request", async () => {
    let rejectDiscovery!: (error: Error) => void;
    request.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectDiscovery = reject; }))
      .mockResolvedValueOnce(frontends)
      .mockRejectedValueOnce(new Error("Frontend unavailable"));
    const { root, button, submitFolder, settle, selectCandidate } = render();

    submitFolder("backend", "/invalid");
    expect(root.querySelector('[role="status"]')?.textContent).toContain("Reading workspace candidates");
    expect(button(".client-links-choose-frontend").disabled).toBe(true);
    rejectDiscovery(new Error("Backend directory unavailable"));
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("Backend directory unavailable");

    submitFolder("frontend", "/workspace");
    await settle();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    selectCandidate("admin");
    button(".client-links-analyze").click();
    await settle();
    expect(request).toHaveBeenLastCalledWith("client-links", {
      frontends: [{ root: "/workspace/admin" }], links: [],
    });
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("Frontend unavailable");
    expect(root.querySelector(".client-links-results")).toBeNull();
    selectCandidate("admin");
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });
});
