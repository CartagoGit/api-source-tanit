/**
 * The sections that drew nothing until somebody asked.
 *
 * ## What these tests are for
 *
 * The app had the screens, the stores and the clients — and the
 * wiring between them was missing in the places that matter:
 *
 *   · The endpoints list, the services list, the history list and the
 *     Export Center all had a way to load their data, and **nothing
 *     called it**. The explorer was empty until the user touched a
 *     filter; the services section said "no services discovered"
 *     about a project that had them; the Export Center said "nothing
 *     would be written" — which is exactly what it was claiming
 *     before you decided to write anything.
 *   · The live store took the connector as a **constructor parameter
 *     typed as an interface**. Angular cannot inject a type that has
 *     no value, so the bridge was `undefined` and the watch was never
 *     subscribed. On top of that, `connect()` was called by nobody.
 *   · Five sections carried their own `projectRoot` input, defaulting
 *     to `"."`, and the shell never passed one: the watch, the check,
 *     the sync, the validation and the upload would have acted on the
 *     current directory instead of the project the user opened.
 *
 * These tests ask the backend was asked, and with what.
 */
import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";

import { EndpointsListComponent } from "../../packages/app/src/app/features/endpoints/endpoints-list.component";
import { ServicesListComponent } from "../../packages/app/src/app/features/services/services-list.component";
import { HistoryListComponent } from "../../packages/app/src/app/features/history/history-list.component";
import { ExportCenterComponent } from "../../packages/app/src/app/features/exports/export-center.component";
import { LiveToggleComponent } from "../../packages/app/src/app/features/live/live-toggle.component";
import { CheckComponent } from "../../packages/app/src/app/features/check/check.component";
import { SyncComponent } from "../../packages/app/src/app/features/sync/sync.component";
import { ValidateComponent } from "../../packages/app/src/app/features/validate/validate.component";
import { ServiceDetailComponent } from "../../packages/app/src/app/features/services/service-detail.component";
import { ProjectStore } from "../../packages/app/src/app/core/state/project.store";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";

/** What the fake backend answered. */
interface ICall {
  readonly operation: string;
  readonly input: unknown;
}

/** A bridge that answers, counts the calls and keeps the listeners. */
function fakeBridge(): {
  bridge: {
    request: (operation: string, input: unknown) => Promise<unknown>;
    subscribe: (listener: (event: unknown) => void) => () => void;
  };
  calls: ICall[];
  listeners: Array<(event: unknown) => void>;
} {
  const calls: ICall[] = [];
  const listeners: Array<(event: unknown) => void> = [];
  const bridge = {
    request: vi.fn(async (operation: string, input: unknown) => {
      calls.push({ operation, input });
      switch (operation) {
        case "list-endpoints":
          return { endpoints: [], nextCursor: null, total: 0, indexedTotal: 0 };
        case "list-services":
          return { services: [] };
        case "history":
          return { entries: [], total: 0 };
        case "history-list":
          return { entries: [], total: 0 };
        case "service-detail":
          return {
            service: {
              serviceId: "api",
              framework: "express",
              endpointCount: 3,
              transports: ["http"],
              operationCount: 3,
            },
          };
        case "dry-run":
          return {
            endpointCount: 0,
            frameworks: [],
            warnings: [],
            durationMs: 0,
            files: [],
            formats: [],
          };
        case "watch":
          return {
            subscription: { subscriptionId: "sub-1", projectRoot: "/workspace", onlyPaths: null },
          };
        case "cancel":
          return { cancelled: 1 };
        default:
          throw new Error(`unexpected operation: ${operation}`);
      }
    }),
    subscribe: vi.fn((listener: (event: unknown) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    }),
  };
  return { bridge, calls, listeners };
}

/** Lets the promises the effects started settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, 0); });
}

/** The calls made for one operation. */
function callsFor(calls: readonly ICall[], operation: string): ICall[] {
  return calls.filter((call) => call.operation === operation);
}

describe("the sections that load when the project opens", () => {
  it("asks the backend for the endpoints", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const project = TestBed.inject(ProjectStore);
    TestBed.runInInjectionContext(() => new EndpointsListComponent());

    project.projectRoot.set("/workspace");
    TestBed.flushEffects();
    await settle();

    expect(callsFor(calls, "list-endpoints")).toHaveLength(1);
    expect(callsFor(calls, "list-endpoints")[0]?.input).toMatchObject({ projectRoot: "/workspace" });
  });

  it("asks the backend for the services", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const project = TestBed.inject(ProjectStore);
    TestBed.runInInjectionContext(() => new ServicesListComponent());

    project.projectRoot.set("/workspace");
    TestBed.flushEffects();
    await settle();

    expect(callsFor(calls, "list-services")).toHaveLength(1);
  });

  it("asks the backend for the session history", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const project = TestBed.inject(ProjectStore);
    TestBed.runInInjectionContext(() => new HistoryListComponent());

    project.projectRoot.set("/workspace");
    TestBed.flushEffects();
    await settle();

    expect(callsFor(calls, "history")).toHaveLength(1);
  });

  it("asks the backend what the export would write", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const project = TestBed.inject(ProjectStore);
    TestBed.runInInjectionContext(() => new ExportCenterComponent());

    project.projectRoot.set("/workspace");
    TestBed.flushEffects();
    await settle();

    expect(callsFor(calls, "dry-run").length).toBeGreaterThan(0);
    expect(callsFor(calls, "dry-run")[0]?.input).toMatchObject({ projectRoot: "/workspace" });
  });

  it("asks for nothing while there is no project", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    TestBed.runInInjectionContext(() => new EndpointsListComponent());

    TestBed.flushEffects();
    await settle();

    expect(calls).toHaveLength(0);
  });
});

describe("the live mode", () => {
  it("watches the open project, not the current directory", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const project = TestBed.inject(ProjectStore);
    project.projectRoot.set("/workspace");
    const component = TestBed.runInInjectionContext(() => new LiveToggleComponent());

    await component.toggle(checked(true));
    await settle();

    expect(callsFor(calls, "watch")).toHaveLength(1);
    expect(callsFor(calls, "watch")[0]?.input).toMatchObject({ projectRoot: "/workspace" });
  });

  it("cancels the subscription when the toggle goes off", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const project = TestBed.inject(ProjectStore);
    project.projectRoot.set("/workspace");
    const component = TestBed.runInInjectionContext(() => new LiveToggleComponent());

    await component.toggle(checked(true));
    await component.toggle(checked(false));
    await settle();

    expect(callsFor(calls, "cancel")).toHaveLength(1);
    expect(callsFor(calls, "cancel")[0]?.input).toMatchObject({ subscriptionId: "sub-1" });
  });

  it("receives the changes the backend pushes", async () => {
    const { bridge, listeners } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const component = TestBed.runInInjectionContext(() => new LiveToggleComponent());

    expect(listeners.length).toBeGreaterThan(0);
    listeners[0]?.({ sourceFileCount: 3, changes: [{ path: "src/a.ts", kind: "changed" }] });

    expect(component.store.sourceFileCount()).toBe(3);
    expect(component.store.changes()).toHaveLength(1);
  });

  it("says that there is nothing to watch when there is no project", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const component = TestBed.runInInjectionContext(() => new LiveToggleComponent());

    await component.toggle(checked(true));

    expect(calls).toHaveLength(0);
    expect(component.store.error()).toContain("Open a project");
  });
});

describe("the CLI-only sections", () => {
  it("check acts on the open project", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const project = TestBed.inject(ProjectStore);
    project.projectRoot.set("/workspace");
    const component = TestBed.runInInjectionContext(() => new CheckComponent());

    await component.run();

    expect(callsFor(calls, "check")).toHaveLength(1);
    expect(callsFor(calls, "check")[0]?.input).toMatchObject({ projectRoot: "/workspace" });
  });

  it("sync acts on the open project", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const project = TestBed.inject(ProjectStore);
    project.projectRoot.set("/workspace");
    const component = TestBed.runInInjectionContext(() => new SyncComponent());

    await component.run(false);

    expect(callsFor(calls, "sync")[0]?.input).toMatchObject({ projectRoot: "/workspace" });
  });

  it("validate acts on the open project", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const project = TestBed.inject(ProjectStore);
    project.projectRoot.set("/workspace");
    const component = TestBed.runInInjectionContext(() => new ValidateComponent());

    await component.run();

    expect(callsFor(calls, "validate")[0]?.input).toMatchObject({ projectRoot: "/workspace" });
  });
});

describe("the detail of one service", () => {
  it("asks the backend for it, and says what came back", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const project = TestBed.inject(ProjectStore);
    project.projectRoot.set("/workspace");
    const component = TestBed.runInInjectionContext(() => new ServiceDetailComponent());

    await component.load("api");

    expect(callsFor(calls, "service-detail")[0]?.input).toMatchObject({
      projectRoot: "/workspace",
      serviceId: "api",
    });
    expect(component.error()).toBeNull();
    expect(component.service()?.endpointCount).toBe(3);
  });
});

/**
 * A change event on a checkbox.
 *
 * A real DOM event, dispatched on a real input: the component reads
 * `event.target.checked`, and a made-up object would have needed a
 * cast to pretend to be an event.
 */
function checked(value: boolean): Event {
  const input = document.createElement("input");
  input.checked = value;
  const event = new Event("change");
  input.dispatchEvent(event);
  return event;
}
