import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  ClientProjectCandidates,
  IClientProjectLinksReport,
} from "../../packages/contracts/interfaces/core/client-consumption.interface";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";
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
    expect(results?.textContent).toContain("DELETE /items");
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
