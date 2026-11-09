import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSettingsHandler } from "../../packages/core/application-api/settings.handlers.js";
import { generateCollections } from "../../packages/core/discovery/generation.pipeline.js";
import { closeAllSessions, getSession, openSession } from "../../packages/core/session/project-session.service.js";
import type { IDiscoveryOrchestrator } from "../../packages/contracts/interfaces/core/scanner.interface.js";

vi.mock("../../packages/core/discovery/generation.pipeline.js", () => ({ generateCollections: vi.fn() }));

const scan = vi.mocked(generateCollections);
const root = "/settings-session";
const orchestrator: IDiscoveryOrchestrator = {
  detectAll: vi.fn(),
  detectAllWithDiagnostics: vi.fn(),
  forceFramework: vi.fn(),
  supportedFrameworks: vi.fn(),
};
const handler = createSettingsHandler();

beforeEach(() => {
  closeAllSessions();
  scan.mockReset().mockResolvedValue([]);
});
afterEach(closeAllSessions);

describe("effective session settings", () => {
  test("GET exposes effective defaults and needs no request orchestrator", async () => {
    const session = await openSession(root, { generationOptions: { orchestrator, collectionName: "Original" } });
    const result = await handler.handle({ projectRoot: root }, { caller: "cli" });
    expect(result).toEqual({
      applied: { collectionName: "Original", watch: false, watchDebounceMs: 500 },
      settings: { collectionName: "Original", watch: false, watchDebounceMs: 500 },
      sessionId: session.id,
    });
    expect(scan).toHaveBeenCalledTimes(1);
  });

  test("partial patch preserves generation options, watch options and session identity", async () => {
    const session = await openSession(root, {
      generationOptions: { orchestrator, collectionName: "Original", forceFramework: "example" },
      watchDebounceMs: 75,
    });
    const result = await handler.handle({ projectRoot: root, patch: { collectionName: "Updated" } }, { caller: "web" });
    expect(result.settings).toEqual({ collectionName: "Updated", watch: false, watchDebounceMs: 75 });
    expect(result.applied).toEqual({ collectionName: "Updated" });
    expect(result.sessionId).toBe(session.id);
    expect(getSession(root)).toBe(session);
    expect(session.current().sessionId).toBe(session.id);
    expect(scan).toHaveBeenLastCalledWith(root, { orchestrator, collectionName: "Updated", forceFramework: "example" });
  });

  test("watch-only patch preserves collection options and avoids rescanning", async () => {
    const session = await openSession(root, { generationOptions: { orchestrator, collectionName: "Original" } });
    const original = session.current();
    const listener = vi.fn();
    session.on("snapshot-ready", listener);
    await handler.handle({ projectRoot: root, patch: { watchDebounceMs: 150 } }, { caller: "cli" });
    expect(session.settings()).toEqual({ collectionName: "Original", watch: false, watchDebounceMs: 150 });
    expect(session.current()).toBe(original);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });

  test("failed scan leaves old snapshot, effective settings and session usable", async () => {
    const session = await openSession(root, { generationOptions: { orchestrator, collectionName: "Original" }, watchDebounceMs: 75 });
    const original = session.current();
    scan.mockRejectedValueOnce(new Error("scan failed"));
    await expect(handler.handle({ projectRoot: root, patch: { collectionName: "Broken", watchDebounceMs: 300 } }, { caller: "web" }))
      .rejects.toMatchObject({ code: "EXECUTION_FAILED", message: "scan failed" });
    expect(getSession(root)).toBe(session);
    expect(session.current()).toBe(original);
    expect(session.settings()).toEqual({ collectionName: "Original", watch: false, watchDebounceMs: 75 });
    await session.configure({ collectionName: "Recovered" });
    expect(session.settings().collectionName).toBe("Recovered");
  });

  test("concurrent partial patches merge after the preceding update completes", async () => {
    const session = await openSession(root, { generationOptions: { orchestrator, collectionName: "Original" } });
    await Promise.all([
      session.configure({ collectionName: "Updated" }),
      session.configure({ watchDebounceMs: 150 }),
    ]);
    expect(session.settings()).toEqual({ collectionName: "Updated", watch: false, watchDebounceMs: 150 });
  });

  test("abort while preparing candidate keeps the previous snapshot and configuration", async () => {
    const session = await openSession(root, { generationOptions: { orchestrator, collectionName: "Original" } });
    const original = session.current();
    const signal = { aborted: false };
    scan.mockImplementationOnce(async () => { signal.aborted = true; return []; });
    await expect(session.configure({ collectionName: "Canceled" }, signal)).rejects.toThrow("aborted");
    expect(session.current()).toBe(original);
    expect(session.settings().collectionName).toBe("Original");
  });

  test("configuration retains listeners and notifies them with the same session identity", async () => {
    const session = await openSession(root, { generationOptions: { orchestrator } });
    const listener = vi.fn();
    session.on("snapshot-ready", listener);
    await session.configure({ collectionName: "Updated" });
    expect(listener).toHaveBeenCalledWith({ snapshot: session.current() });
    expect(session.current().sessionId).toBe(session.id);
  });
});
