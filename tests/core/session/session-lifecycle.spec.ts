import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { closeAllSessions, getSession, openSession } from "../../../packages/core/session/project-session.service.js";
import { SessionClosedError } from "../../../packages/core/session/session-error.js";
import type { IDiscoveryOrchestrator } from "../../../packages/contracts/interfaces/core/scanner.interface.js";

const closeWatcher = vi.hoisted(() => vi.fn());
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  watch: vi.fn(() => ({ close: closeWatcher })),
}));
vi.mock("../../../packages/core/discovery/generation.pipeline.js", () => ({ generateCollections: vi.fn(async () => []) }));

const orchestrator: IDiscoveryOrchestrator = {
  detectAll: async () => [],
  detectAllWithDiagnostics: async () => ({ detected: [], diagnostics: [] }),
  forceFramework: async () => null,
  supportedFrameworks: () => [],
};
const root = "/lifecycle/one";
const options = { generationOptions: { orchestrator }, watch: true };

beforeEach(() => {
  closeAllSessions();
  closeWatcher.mockReset();
});
afterEach(closeAllSessions);

describe("session lifecycle", () => {
  test("close emits once after unregistering, releases watcher and rejects new listeners", async () => {
    const session = await openSession(root, options);
    const closed = vi.fn(() => {
      expect(getSession(root)).toBeNull();
      session.close(); // Closing from a close observer remains idempotent.
    });
    session.on("session-closed", closed);
    session.close();
    session.close();
    expect(closed).toHaveBeenCalledExactlyOnceWith({ sessionId: session.id, projectRoot: root });
    expect(closeWatcher).toHaveBeenCalledTimes(1);
    expect(() => session.current()).toThrow(SessionClosedError);
    expect(() => session.on("snapshot-ready", vi.fn())).toThrow(SessionClosedError);
  });

  test("a throwing observer cannot prevent later lifecycle observers or cleanup", async () => {
    const session = await openSession(root, options);
    session.on("session-closed", () => { throw new Error("observer failed"); });
    const otherOwner = vi.fn();
    session.on("session-closed", otherOwner);
    expect(() => session.close()).toThrow(AggregateError);
    expect(otherOwner).toHaveBeenCalledExactlyOnceWith({ sessionId: session.id, projectRoot: root });
    expect(getSession(root)).toBeNull();
    expect(closeWatcher).toHaveBeenCalledTimes(1);
    expect(() => session.current()).toThrow(SessionClosedError);
    expect(() => session.close()).not.toThrow();
    expect(otherOwner).toHaveBeenCalledTimes(1);
  });

  test("watcher disposal failure still releases identity and handlers", async () => {
    const session = await openSession(root, options);
    closeWatcher.mockImplementationOnce(() => { throw new Error("watcher failed"); });
    expect(() => session.close()).toThrow(AggregateError);
    expect(getSession(root)).toBeNull();
    expect(() => session.on("session-closed", vi.fn())).toThrow(SessionClosedError);
    expect(() => session.close()).not.toThrow();
    expect(closeWatcher).toHaveBeenCalledTimes(1);
  });

  test("closeAll notifies and closes every session even if one observer fails", async () => {
    const first = await openSession(root, options);
    const secondRoot = "/lifecycle/two";
    const second = await openSession(secondRoot, options);
    const firstClosed = vi.fn(() => { throw new Error("first observer failed"); });
    const secondClosed = vi.fn();
    first.on("session-closed", firstClosed);
    second.on("session-closed", secondClosed);
    expect(() => closeAllSessions()).toThrow(AggregateError);
    expect(firstClosed).toHaveBeenCalledTimes(1);
    expect(secondClosed).toHaveBeenCalledExactlyOnceWith({ sessionId: second.id, projectRoot: secondRoot });
    expect(getSession(root)).toBeNull();
    expect(getSession(secondRoot)).toBeNull();
    expect(closeWatcher).toHaveBeenCalledTimes(2);
    expect(() => closeAllSessions()).not.toThrow();
  });

  test("reopening the same root has a new identity unaffected by an old repeated close", async () => {
    const first = await openSession(root, options);
    first.close();
    const second = await openSession(root, options);
    first.close();
    expect(second.id).not.toBe(first.id);
    expect(getSession(root)).toBe(second);
    expect(second.current().sessionId).toBe(second.id);
  });

  test("settings updates retain lifecycle listeners and the stable session identity", async () => {
    const session = await openSession(root, options);
    const closed = vi.fn();
    session.on("session-closed", closed);
    await session.configure({ collectionName: "Updated" });
    expect(closed).not.toHaveBeenCalled();
    session.close();
    expect(closed).toHaveBeenCalledExactlyOnceWith({ sessionId: session.id, projectRoot: root });
  });
});
