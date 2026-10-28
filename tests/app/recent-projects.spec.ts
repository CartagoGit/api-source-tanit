// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { RecentProjectsStore } from "../../packages/app/src/app/core/state/recent-projects.store";
import { RecentProjectsClient } from "../../packages/app/src/app/core/api/recent-projects.client";

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

  it("calls the browser browse endpoint", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, path: "/home", parent: null, entries: [], truncated: false }), { status: 200 });
    await expect(new RecentProjectsClient().browse("/home")).resolves.toMatchObject({ path: "/home" });
    globalThis.fetch = originalFetch;
  });
});