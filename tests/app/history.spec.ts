/**
 * The history of the project, against the real backend.
 *
 * ## What these tests are for
 *
 * The history screen used to show the **events** of the open session
 * and to say, in a note, that the persisted history was not exposed.
 * It was not exposed because there was nothing to expose: the
 * revisions were never written anywhere, the diff had no two
 * revisions to compare, and the handlers the app asked for did not
 * exist — so the call went out under a name the dispatcher did not
 * know and came back `UNKNOWN_HANDLER`.
 *
 * Now the revisions are on disk (`~/.tanit/history/`), the handlers
 * exist, and the screen shows both things: what happened while the
 * project was open, and the past revisions it has been through.
 *
 * These tests pin down the wiring: the store asks for both, forgets
 * the previous project's revisions when the project changes, and the
 * comparison only happens between two **different** revisions.
 */
import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";

import { HistoryStore } from "../../packages/app/src/app/core/state/history.store";
import { HistoryListComponent } from "../../packages/app/src/app/features/history/history-list.component";
import { HistoryDiffComponent } from "../../packages/app/src/app/features/history/history-diff.component";
import { ProjectStore } from "../../packages/app/src/app/core/state/project.store";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";
import type { IHistorySummary } from "../../packages/contracts/interfaces/core/history.interface";

/** A revision, with everything the contract declares. */
function revision(id: string, count: number): IHistorySummary {
  return {
    id,
    timestamp: `2026-10-31T10:0${count}:00.000Z`,
    formats: ["postman"],
    count,
    output: `/workspace/api.json`,
    sha256: `sha-${id}`,
    source: "export",
  };
}

/** A bridge that answers with what the test says. */
function fakeBridge(): {
  bridge: { request: (operation: string, input: unknown) => Promise<unknown> };
  calls: Array<{ operation: string; input: unknown }>;
} {
  const calls: Array<{ operation: string; input: unknown }> = [];
  const bridge = {
    request: vi.fn(async (operation: string, input: unknown) => {
      calls.push({ operation, input });
      switch (operation) {
        case "history":
          return {
            entries: [{ kind: "snapshot-ready", capturedAt: "2026-10-31T10:00:00.000Z" }],
            total: 1,
          };
        case "history-list":
          return { entries: [revision("a", 3), revision("b", 4)], total: 2 };
        case "history-diff":
          return {
            services: ["api"],
            operations: ["GET /users"],
            added: ["POST /users"],
            removed: [],
            changed: ["GET /users"],
            schemaChanges: [],
            authChanges: [],
            serviceChanges: [],
            operationChanges: [],
            configuration: { before: { formats: ["postman"] }, after: { formats: ["openapi"] } },
          };
        default:
          throw new Error(`unexpected operation: ${operation}`);
      }
    }),
  };
  return { bridge, calls };
}

/** The calls made for one operation. */
function callsFor(
  calls: ReadonlyArray<{ operation: string; input: unknown }>,
  operation: string,
): Array<{ operation: string; input: unknown }> {
  return calls.filter((call) => call.operation === operation);
}

/** Lets the promises the effects started settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, 0); });
}

describe("the history store", () => {
  it("asks for the events of the session and for the revisions", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const store = TestBed.inject(HistoryStore);

    await store.load("/workspace");

    expect(callsFor(calls, "history")).toHaveLength(1);
    expect(callsFor(calls, "history-list")).toHaveLength(1);
    expect(store.entries()).toHaveLength(1);
    expect(store.revisions()).toHaveLength(2);
    expect(store.loading()).toBe(false);
  });

  it("forgets the previous project's revisions when the project changes", async () => {
    const { bridge } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const project = TestBed.inject(ProjectStore);
    const store = TestBed.inject(HistoryStore);

    project.projectRoot.set("/workspace");
    await store.load("/workspace");
    expect(store.revisions()).toHaveLength(2);

    project.projectRoot.set("/other");
    TestBed.flushEffects();

    expect(store.revisions()).toHaveLength(0);
    expect(store.entries()).toHaveLength(0);
  });

  it("says what went wrong instead of showing an empty list as if it were empty", async () => {
    const bridge = {
      request: vi.fn(async (operation: string) => {
        if (operation === "history") return { entries: [], total: 0 };
        throw new Error("the history folder is not readable");
      }),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const store = TestBed.inject(HistoryStore);

    await store.load("/workspace");

    expect(store.error()).toContain("not readable");
  });
});

describe("the history screen", () => {
  it("compares two different revisions, and only that", async () => {
    const { bridge } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const component = TestBed.runInInjectionContext(() => new HistoryListComponent());

    // Nothing picked yet: there is nothing to compare.
    expect(component.canCompare()).toBe(false);

    component.left.set("a");
    expect(component.canCompare()).toBe(false);

    component.right.set("a");
    // The same revision twice is not a comparison.
    expect(component.canCompare()).toBe(false);

    component.right.set("b");
    expect(component.canCompare()).toBe(true);
  });

  it("names a revision with when it was made and what it held", async () => {
    const { bridge } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const component = TestBed.runInInjectionContext(() => new HistoryListComponent());

    const label = component.label(revision("a", 3));

    expect(label).toContain("2026-10-31T10:03:00.000Z");
    expect(label).toContain("3");
  });
});

describe("the comparison", () => {
  it("asks the backend what changed between the two revisions", async () => {
    const { bridge, calls } = fakeBridge();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const project = TestBed.inject(ProjectStore);
    project.projectRoot.set("/workspace");
    const fixture = TestBed.createComponent(HistoryDiffComponent);
    fixture.componentRef.setInput("leftId", "a");
    fixture.componentRef.setInput("rightId", "b");
    // The component compares by itself: the effect that watches the
    // two revisions is what makes the request, so the test only has
    // to let the cycle happen.
    fixture.detectChanges();
    await settle();

    expect(callsFor(calls, "history-diff")[0]?.input).toMatchObject({
      projectRoot: "/workspace",
      leftId: "a",
      rightId: "b",
    });
    expect(fixture.componentInstance.result?.added).toEqual(["POST /users"]);
  });
});
