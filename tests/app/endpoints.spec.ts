// @vitest-environment jsdom

import "@angular/compiler";
import "zone.js";
import "zone.js/testing";

import { describe, expect, it, vi } from "vitest";
import { getTestBed, TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";

import { ENDPOINT_TRANSPORTS, EndpointsClient, createEndpointDataset } from "../../packages/app/src/app/core/api/endpoints.client";
import { EndpointsStore } from "../../packages/app/src/app/core/state/endpoints.store";
import { EndpointDetailComponent } from "../../packages/app/src/app/features/endpoints/endpoint-detail.component";
import { EndpointsListComponent } from "../../packages/app/src/app/features/endpoints/endpoints-list.component";
import { FiltersComponent } from "../../packages/app/src/app/features/endpoints/filters.component";
import { SchemaViewerComponent } from "../../packages/app/src/app/features/endpoints/schema-viewer.component";
import { CodeSnippetComponent } from "../../packages/app/src/app/features/endpoints/code-snippet.component";
import { VirtualScrollerComponent } from "../../packages/app/src/app/shared/virtual-scroll/virtual-scroller.component";

getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

describe("Endpoints Explorer", () => {
  it("creates and virtualizes 5,000 endpoint records", () => {
    const items = createEndpointDataset();
    expect(items).toHaveLength(5000);
    expect(items[0]?.id).toBe("endpoint-0");
    expect(items[4999]?.id).toBe("endpoint-4999");

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [VirtualScrollerComponent] });
    const fixture = TestBed.createComponent(VirtualScrollerComponent);
    fixture.componentRef.setInput("items", items);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll(".cdk-virtual-scroll-content-wrapper > *").length).toBeLessThan(40);
    fixture.destroy();
  });

  it("applies combinable filters without changing the indexed dataset", () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [EndpointsClient, EndpointsStore] });
    const store = TestBed.inject(EndpointsStore);
    store.setQuery({ service: "service-1", transport: "http", auth: "bearer", validation: "validated", search: "resources" });
    expect(store.all()).toHaveLength(5000);
    expect(store.filtered().length).toBeGreaterThan(0);
    expect(store.filtered().every((item) => item.service === "service-1" && item.transport === "http" && item.auth === "bearer" && item.validation === "validated")).toBe(true);
  });

  it("supports all six transport adapters", () => {
    const transports = new Set(createEndpointDataset(ENDPOINT_TRANSPORTS.length).map((item) => item.transport));
    expect([...transports]).toEqual([...ENDPOINT_TRANSPORTS]);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [EndpointDetailComponent] });
    const detail = TestBed.runInInjectionContext(() => new EndpointDetailComponent());
    for (const transport of ENDPOINT_TRANSPORTS) expect(detail.transportTitle(transport)).toBeTruthy();
  });

  it("exposes evidence locations, deep-link query params, schema and snippet contracts", async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [EndpointsListComponent, EndpointDetailComponent, FiltersComponent, SchemaViewerComponent, CodeSnippetComponent, VirtualScrollerComponent] });
    const list = TestBed.createComponent(EndpointsListComponent);
    list.detectChanges();
    list.componentInstance.select("endpoint-42");
    expect(window.location.search).toContain("endpoint=endpoint-42");
    expect(list.componentInstance.store.selected()?.evidence[0]?.sourceFile).toContain("src/");

    const schema = TestBed.createComponent(SchemaViewerComponent);
    expect(schema.componentInstance.format({ properties: { id: { type: "string" } } })).toContain('"properties"');

    const snippet = TestBed.createComponent(CodeSnippetComponent);
    expect(snippet.componentInstance.locationFor("src/items.ts", 12, 4)).toBe("src/items.ts:12:4");
    list.destroy(); schema.destroy(); snippet.destroy();
    await Promise.resolve();
  });

  it("keeps detail width within resize bounds", () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [EndpointDetailComponent] });
    const detail = TestBed.runInInjectionContext(() => new EndpointDetailComponent());
    const event = { clientX: 0, pointerId: 1, currentTarget: { setPointerCapture: vi.fn() } } as unknown as PointerEvent;
    detail.startResize(event);
    detail.onMove({ clientX: -1000 } as PointerEvent);
    expect(detail.width()).toBe(720);
    detail.onMove({ clientX: 1000 } as PointerEvent);
    expect(detail.width()).toBe(300);
  });
});