import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSession, getSession, closeAllSessions } from "../../packages/core/session/project-session.service.js";
import { createCancelHandler } from "../../packages/core/application-api/cancel.handler.js";
import { createCloseHandler } from "../../packages/core/application-api/close.handler.js";
import { recordHistoryEntry } from "../../packages/core/application-api/history.handlers.js";
import {
  clearSubscriptions,
  dropSubscriptionById,
  listSubscriptions,
  registerSubscription,
} from "../../packages/core/application-api/watch.handlers.js";
import type { IDiscoveryOrchestrator } from "../../packages/contracts/interfaces/core/scanner.interface.js";

vi.mock("../../packages/core/application-api/history.handlers.js", () => ({ recordHistoryEntry: vi.fn() }));

let root: string;
const orchestrator: IDiscoveryOrchestrator = {
  detectAll: async () => [],
  detectAllWithDiagnostics: async () => ({ detected: [], diagnostics: [] }),
  forceFramework: async () => null,
  supportedFrameworks: () => [],
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tanit-subscriptions-"));
  vi.clearAllMocks();
});
afterEach(async () => {
  clearSubscriptions();
  closeAllSessions();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function sessionAt(projectRoot = root) {
  return openSession(projectRoot, { generationOptions: { orchestrator } });
}

describe("watch subscription lifecycle", () => {
  test("shares one history observer and releases it after the last cancellation", async () => {
    const session = await sessionAt();
    const on = vi.spyOn(session, "on");
    const off = vi.spyOn(session, "off");
    const first = registerSubscription(root, null);
    const second = registerSubscription(root, null);
    expect(on).toHaveBeenCalledTimes(3);
    const ready = on.mock.calls.find(([event]) => event === "snapshot-ready")?.[1];
    expect(ready).toBeDefined();
    ready?.({ snapshot: session.current() });
    expect(recordHistoryEntry).toHaveBeenCalledTimes(1);

    expect(dropSubscriptionById(first.subscriptionId)).toBe(true);
    expect(off).not.toHaveBeenCalled();
    ready?.({ snapshot: session.current() });
    expect(recordHistoryEntry).toHaveBeenCalledTimes(2);
    expect(dropSubscriptionById(second.subscriptionId)).toBe(true);
    expect(off).toHaveBeenCalledTimes(3);
    ready?.({ snapshot: session.current() });
    expect(recordHistoryEntry).toHaveBeenCalledTimes(2);
    expect(dropSubscriptionById(second.subscriptionId)).toBe(false);
    expect(listSubscriptions()).toEqual([]);
  });

  test("records a stale event once when any active path filter matches", async () => {
    const session = await sessionAt();
    const on = vi.spyOn(session, "on");
    const first = registerSubscription(root, ["routes/"]);
    registerSubscription(root, ["controllers/"]);
    const stale = on.mock.calls.find(([event]) => event === "snapshot-stale")?.[1];
    stale?.({ changedPaths: ["ignored/file.ts"] });
    expect(recordHistoryEntry).not.toHaveBeenCalled();
    stale?.({ changedPaths: ["routes/api.ts", "controllers/user.ts"] });
    expect(recordHistoryEntry).toHaveBeenCalledTimes(1);
    dropSubscriptionById(first.subscriptionId);
    stale?.({ changedPaths: ["routes/api.ts"] });
    expect(recordHistoryEntry).toHaveBeenCalledTimes(1);
  });

  test("clear detaches callbacks and resubscribe installs one fresh observer", async () => {
    const session = await sessionAt();
    const on = vi.spyOn(session, "on");
    const off = vi.spyOn(session, "off");
    registerSubscription(root, null);
    clearSubscriptions();
    expect(off).toHaveBeenCalledTimes(3);
    registerSubscription(root, null);
    expect(on).toHaveBeenCalledTimes(6);
    expect(listSubscriptions()).toHaveLength(1);
  });

  test("direct and repeated close release subscriptions before reopening the same root", async () => {
    const session = await sessionAt();
    const on = vi.spyOn(session, "on");
    const off = vi.spyOn(session, "off");
    registerSubscription(root, null);
    const oldReady = on.mock.calls.find(([event]) => event === "snapshot-ready")?.[1];
    session.close();
    session.close();
    expect(off).toHaveBeenCalledTimes(3);
    expect(listSubscriptions()).toEqual([]);
    const reopened = await sessionAt();
    expect(reopened.id).not.toBe(session.id);
    const freshOn = vi.spyOn(reopened, "on");
    registerSubscription(root, null);
    oldReady?.({ snapshot: reopened.current() });
    expect(recordHistoryEntry).not.toHaveBeenCalled();
    freshOn.mock.calls.find(([event]) => event === "snapshot-ready")?.[1]({ snapshot: reopened.current() });
    expect(recordHistoryEntry).toHaveBeenCalledTimes(1);
  });

  test("closeAllSessions clears subscriptions for every project", async () => {
    await sessionAt();
    const otherRoot = await mkdtemp(join(root, "other-"));
    await sessionAt(otherRoot);
    registerSubscription(root, null);
    registerSubscription(otherRoot, null);
    closeAllSessions();
    expect(listSubscriptions()).toEqual([]);
  });

  test("a settings update preserves the subscription observer and session identity", async () => {
    const session = await sessionAt();
    const on = vi.spyOn(session, "on");
    const sub = registerSubscription(root, null);
    await session.configure({ collectionName: "Updated" });
    expect(listSubscriptions()).toEqual([sub]);
    expect(session.current().sessionId).toBe(session.id);
    expect(on).toHaveBeenCalledTimes(3);
    expect(recordHistoryEntry).toHaveBeenCalledTimes(1);
    session.close();
    expect(listSubscriptions()).toEqual([]);
  });

  test.each(["cancel", "close"])("%s releases only the selected project's subscriptions", async (action) => {
    const session = await sessionAt();
    const otherRoot = await mkdtemp(join(root, "other-"));
    const other = await sessionAt(otherRoot);
    const off = vi.spyOn(session, "off");
    const otherOff = vi.spyOn(other, "off");
    registerSubscription(root, null);
    const retained = registerSubscription(otherRoot, null);
    const context = { caller: "cli" as const };
    if (action === "cancel") {
      expect(await createCancelHandler().handle({ projectRoot: root }, context)).toEqual({ cancelled: 1 });
    } else {
      expect(await createCloseHandler().handle({ projectRoot: root }, context)).toEqual({ closed: 1 });
    }
    expect(off).toHaveBeenCalledTimes(3);
    expect(otherOff).not.toHaveBeenCalled();
    expect(listSubscriptions()).toEqual([retained]);
  });
});

describe("API controls cancel pending session openings", () => {
  test.each(["cancel", "close"])("%s prevents a late session after navigation", async (action) => {
    let release!: () => void;
    let began!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { began = resolve; });
    const opening = openSession(root, { generationOptions: { orchestrator: {
      ...orchestrator, detectAll: async () => { began(); await pending; return []; },
    } } });
    await started;
    if (action === "cancel") {
      expect(await createCancelHandler().handle({ projectRoot: root }, { caller: "cli" })).toEqual({ cancelled: 1 });
    } else {
      expect(await createCloseHandler().handle({ projectRoot: root }, { caller: "cli" })).toEqual({ closed: 1 });
    }
    release();
    await expect(opening).rejects.toThrow();
    expect(getSession(root)).toBeNull();
  });
});
