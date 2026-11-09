import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { watch } from "node:fs";
import { generateCollections } from "../../../packages/core/discovery/generation.pipeline.js";
import { closeAllSessions, getSession, openSession } from "../../../packages/core/session/project-session.service.js";
import type { IDiscoveryOrchestrator } from "../../../packages/contracts/interfaces/core/scanner.interface.js";
import type { IGenerationResult } from "../../../packages/contracts/interfaces/core/discovery.interface.js";
import { OUTPUT_DIR_NAME } from "../../../packages/contracts/constants/core/postman.constant.js";

vi.mock("node:fs", async (importOriginal) => ({ ...await importOriginal<typeof import("node:fs")>(), watch: vi.fn() }));
vi.mock("../../../packages/core/discovery/generation.pipeline.js", () => ({ generateCollections: vi.fn() }));
const scan = vi.mocked(generateCollections);
const orchestrator: IDiscoveryOrchestrator = {
  detectAll: async () => [], detectAllWithDiagnostics: async () => ({ detected: [], diagnostics: [] }),
  forceFramework: async () => null, supportedFrameworks: () => [],
};
let changed: ((event: string, filename: string | null) => void) | undefined;
let stop = vi.fn(() => {});

beforeEach(() => {
  vi.useFakeTimers();
  scan.mockReset().mockResolvedValue([]);
  stop = vi.fn(() => {});
  vi.mocked(watch).mockReset().mockImplementation((_root, _options, callback) => {
    changed = callback;
    return { close: stop };
  });
});
afterEach(() => {
  closeAllSessions();
  vi.useRealTimers();
});

async function open() {
  return openSession("/source-project", { generationOptions: { orchestrator }, watch: true, watchDebounceMs: 10 });
}
function deferred() {
  let complete: (results: ReadonlyArray<IGenerationResult>) => void = () => {};
  const promise = new Promise<ReadonlyArray<IGenerationResult>>((resolve) => { complete = resolve; });
  return { promise, complete };
}
function change(path: string) { changed?.("change", path); }

describe("coalesced session rescans", () => {
  test("coalesces a burst and never overlaps scans or publishes an obsolete candidate", async () => {
    const session = await open();
    const ready = vi.fn();
    session.on("snapshot-ready", ready);
    const waiting = deferred();
    scan.mockReturnValueOnce(waiting.promise);
    change("routes/a.ts");
    change("routes/b.ts");
    await vi.advanceTimersByTimeAsync(10);
    expect(scan).toHaveBeenCalledTimes(2);
    change("routes/c.ts");
    change("routes/d.ts");
    await vi.advanceTimersByTimeAsync(100);
    expect(scan).toHaveBeenCalledTimes(2);
    waiting.complete([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).toHaveBeenCalledTimes(3);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(session.current().sessionId).toBe(session.id);
  });

  test("preserves the valid snapshot and emits a truthful failure, then permits retry", async () => {
    const session = await open();
    const previous = session.current();
    const failure = vi.fn();
    const ready = vi.fn();
    session.on("snapshot-error", failure);
    session.on("snapshot-ready", ready);
    scan.mockRejectedValueOnce(new Error("source could not be read"));
    change("routes/broken.ts");
    await vi.advanceTimersByTimeAsync(10);
    expect(failure).toHaveBeenCalledWith({ message: "source could not be read", changedPaths: ["routes/broken.ts"] });
    expect(session.current()).toBe(previous);
    change("routes/fixed.ts");
    await vi.advanceTimersByTimeAsync(10);
    expect(ready).toHaveBeenCalledOnce();
  });

  test("dependency, generated and atomic temporary files do not trigger rescans", async () => {
    const session = await open();
    const stale = vi.fn();
    session.on("snapshot-stale", stale);
    for (const path of ["node_modules/a.js", "vendor/a.php", ".git/index", ".cache/data", "dist/a.js", `${OUTPUT_DIR_NAME}/collection.json`, ".output.123.tmp"]) change(path);
    await vi.advanceTimersByTimeAsync(100);
    expect(scan).toHaveBeenCalledOnce();
    expect(stale).not.toHaveBeenCalled();
  });

  test("closing during a rescan never publishes its late completion", async () => {
    const session = await open();
    const ready = vi.fn();
    const failure = vi.fn();
    session.on("snapshot-ready", ready);
    session.on("snapshot-error", failure);
    const waiting = deferred();
    scan.mockReturnValueOnce(waiting.promise);
    change("routes/a.ts");
    await vi.advanceTimersByTimeAsync(10);
    session.close();
    waiting.complete([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
    expect(getSession("/source-project")).toBeNull();
    expect(stop).toHaveBeenCalledOnce();
  });

  test("disabling watch during a scan prevents a late snapshot or more scans", async () => {
    const session = await open();
    const ready = vi.fn();
    session.on("snapshot-ready", ready);
    const waiting = deferred();
    scan.mockReturnValueOnce(waiting.promise);
    change("routes/a.ts");
    await vi.advanceTimersByTimeAsync(10);
    await session.configure({ watch: false });
    waiting.complete([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(ready).not.toHaveBeenCalled();
    expect(scan).toHaveBeenCalledTimes(2);
  });

  test("configuration and watcher generation share one scan lane", async () => {
    const session = await open();
    const waiting = deferred();
    scan.mockReturnValueOnce(waiting.promise);
    change("routes/a.ts");
    await vi.advanceTimersByTimeAsync(10);
    const configuring = session.configure({ collectionName: "Updated" });
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).toHaveBeenCalledTimes(2);
    waiting.complete([]);
    await configuring;
    expect(scan).toHaveBeenCalledTimes(3);
    expect(session.settings().collectionName).toBe("Updated");
  });

  test("watch startup failure is reported without registering a false live session", async () => {
    vi.mocked(watch).mockImplementationOnce(() => { throw new Error("watch unavailable"); });
    await expect(open()).rejects.toThrow("watch unavailable");
    expect(getSession("/source-project")).toBeNull();
  });
});
