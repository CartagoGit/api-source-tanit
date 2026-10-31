// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";

import { RecentProjectsStore } from "../../packages/app/src/app/core/state/recent-projects.store";
import { RecentProjectsClient } from "../../packages/app/src/app/core/api/recent-projects.client";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";

describe("recent projects", () => {
  it("keeps ten entries, orders by last opened, and persists per scope", () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    const store = new RecentProjectsStore();
    store.load("workspace-a");
    for (let index = 0; index < 12; index += 1) store.add(`/project/${index}`, index);
    expect(store.projects()).toHaveLength(10);
    expect(store.projects()[0]?.path).toBe("/project/11");
    expect(store.projects().at(-1)?.path).toBe("/project/2");

    const restored = new RecentProjectsStore();
    restored.load("workspace-a");
    expect(restored.projects()).toEqual(store.projects());
    restored.remove("/project/11");
    expect(restored.projects().some(({ path }) => path === "/project/11")).toBe(false);
    restored.clear();
    expect(restored.projects()).toHaveLength(0);
  });

  /**
   * The folder list goes through the connector.
   *
   * It used to fetch `/api/browse` over raw HTTP, without the token
   * the bridge sends — a route that only the CLI's own interface
   * serves. In the browser carrier that route does not exist, and in
   * the desktop carrier there is no HTTP at all: the folder list was
   * dead in both, and the client was not even injectable, so the
   * Home screen threw before it drew anything.
   */
  it("asks the connector for the folders", async () => {
    const calls: Array<{ operation: string; input: unknown }> = [];
    const bridge = {
      request: vi.fn(async (operation: string, input: unknown) => {
        calls.push({ operation, input });
        return {
          listing: { ok: true, path: "/home", parent: null, entries: [], truncated: false },
        };
      }),
      requestPending: vi.fn(async () => ({})),
      subscribe: vi.fn(() => () => undefined),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });
    const client = TestBed.runInInjectionContext(() => new RecentProjectsClient());

    const listing = await client.browse("/home");

    expect(calls[0]?.operation).toBe("browse");
    expect(calls[0]?.input).toMatchObject({ path: "/home" });
    expect(listing.path).toBe("/home");
  });

  it("can be built by Angular, which it could not before", () => {
    const bridge = {
      request: vi.fn(async () => ({})),
      requestPending: vi.fn(async () => ({})),
      subscribe: vi.fn(() => () => undefined),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HostBridgeClient, useValue: bridge }],
    });

    // Without `@Injectable` this throws a `NullInjectorError`: the
    // Home screen never drew.
    expect(() => TestBed.inject(RecentProjectsClient)).not.toThrow();
  });
});