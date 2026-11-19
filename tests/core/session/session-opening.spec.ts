import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { basename, join, parse, sep } from "node:path";
import { tmpdir } from "node:os";
import { cancelSessionOpening, closeAllSessions, getSession, openSession } from "../../../packages/core/session/project-session.service.js";
import { generateCollections } from "../../../packages/core/discovery/generation.pipeline.js";
import { SessionAbortedError } from "../../../packages/core/session/session-error.js";
import type { IGenerationResult } from "../../../packages/contracts/interfaces/core/discovery.interface.js";
import type { IDiscoveryOrchestrator } from "../../../packages/contracts/interfaces/core/scanner.interface.js";

const watch = vi.hoisted(() => vi.fn(() => ({ close: vi.fn() })));
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  watch,
}));
vi.mock("../../../packages/core/discovery/generation.pipeline.js", () => ({ generateCollections: vi.fn() }));

const scan = vi.mocked(generateCollections);
const root = join(tmpdir(), "tanit-virtual-session", "api");
const orchestrator: IDiscoveryOrchestrator = {
  detectAll: async () => [],
  detectAllWithDiagnostics: async () => ({ detected: [], diagnostics: [] }),
  forceFramework: async () => null,
  supportedFrameworks: () => [],
};
const options = { generationOptions: { orchestrator } };

function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release: () => release() };
}

beforeEach(() => {
  closeAllSessions();
  scan.mockReset().mockResolvedValue([]);
  watch.mockClear();
});
afterEach(closeAllSessions);

describe("shared session openings", () => {
  test("simultaneous opens of one root scan once and return the same registered session", async () => {
    const gate = barrier();
    scan.mockImplementationOnce(async () => { await gate.promise; return []; });
    const first = openSession(root, options);
    const second = openSession(root, options);
    await Promise.resolve();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(getSession(root)).toBeNull();
    gate.release();
    const [left, right] = await Promise.all([first, second]);
    expect(left).toBe(right);
    expect(getSession(root)).toBe(left);
  });

  test("different project roots retain independent openings", async () => {
    const firstGate = barrier();
    const secondGate = barrier();
    scan.mockImplementationOnce(async () => { await firstGate.promise; return []; });
    scan.mockImplementationOnce(async () => { await secondGate.promise; return []; });
    const otherRoot = join(root, "other");
    const first = openSession(root, options);
    const second = openSession(otherRoot, options);
    await Promise.resolve();
    expect(scan).toHaveBeenCalledTimes(2);
    secondGate.release();
    const other = await second;
    expect(getSession(otherRoot)).toBe(other);
    expect(getSession(root)).toBeNull();
    firstGate.release();
    expect(await first).not.toBe(other);
  });

  test("a failed shared opening releases its slot for retry", async () => {
    scan.mockRejectedValueOnce(new Error("scan failed"));
    const results = await Promise.allSettled([openSession(root, options), openSession(root, options)]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(getSession(root)).toBeNull();
    const recovered = await openSession(root, options);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(getSession(root)).toBe(recovered);
  });

  test("closeAll cancels an in-flight opening before it can allocate a watcher or register", async () => {
    const gate = barrier();
    scan.mockImplementationOnce(async () => { await gate.promise; return []; });
    const pending = openSession(root, { ...options, watch: true });
    const canceled = expect(pending).rejects.toThrow(SessionAbortedError);
    await Promise.resolve();
    closeAllSessions();
    gate.release();
    await canceled;
    expect(getSession(root)).toBeNull();
    expect(watch).not.toHaveBeenCalled();
  });

  test.each(["closeAll", "cancel"])("%s between scan publication and promise delivery never returns a closed session", async (operation) => {
    let complete = () => {};
    const completion = new Promise<IGenerationResult[]>((resolve) => { complete = () => resolve([]); });
    scan.mockReturnValueOnce(completion);
    const pending = openSession(root, options);
    const canceled = expect(pending).rejects.toThrow(SessionAbortedError);
    await Promise.resolve(); // Install the scan's continuation before the closing observer.
    const closed = completion.then(() => {
      expect(getSession(root)).not.toBeNull();
      if (operation === "closeAll") closeAllSessions();
      else expect(cancelSessionOpening(root)).toBe(true);
    });
    complete();
    await closed;
    await canceled;
    expect(getSession(root)).toBeNull();
  });

  test("explicit cancellation permits a new opening and old completion cannot replace it", async () => {
    const gate = barrier();
    scan.mockImplementationOnce(async () => { await gate.promise; return []; });
    const first = openSession(root, options);
    const canceled = expect(first).rejects.toThrow(SessionAbortedError);
    await Promise.resolve();
    expect(cancelSessionOpening(root + sep)).toBe(true);
    expect(cancelSessionOpening(root)).toBe(false);
    const replacement = await openSession(root, options);
    gate.release();
    await canceled;
    expect(getSession(root)).toBe(replacement);
  });

  test("one aborted caller does not cancel a shared opening another caller needs", async () => {
    const gate = barrier();
    scan.mockImplementationOnce(async () => { await gate.promise; return []; });
    const signal = { aborted: false };
    const first = openSession(root, { ...options, signal });
    const canceled = expect(first).rejects.toThrow(SessionAbortedError);
    const second = openSession(root, options);
    signal.aborted = true;
    gate.release();
    const retained = await second;
    await canceled;
    expect(scan).toHaveBeenCalledTimes(1);
    expect(getSession(root)).toBe(retained);
  });

  test("cancel before a scheduled scan starts avoids the scan entirely", async () => {
    const pending = openSession(root, options);
    const canceled = expect(pending).rejects.toThrow(SessionAbortedError);
    expect(cancelSessionOpening(root)).toBe(true);
    await canceled;
    expect(scan).not.toHaveBeenCalled();
    expect(getSession(root)).toBeNull();
  });

  test("all aborted callers leave no session and allow a later retry", async () => {
    const gate = barrier();
    scan.mockImplementationOnce(async () => { await gate.promise; return []; });
    const signal = { aborted: false };
    const pending = openSession(root, { ...options, signal, watch: true });
    const canceled = expect(pending).rejects.toThrow(SessionAbortedError);
    await Promise.resolve();
    signal.aborted = true;
    gate.release();
    await canceled;
    expect(getSession(root)).toBeNull();
    expect(watch).not.toHaveBeenCalled();
    expect(await openSession(root, options)).toBe(getSession(root));
  });

  test("dot segments and trailing native separators share one lexical root", async () => {
    const alias = `${root}${sep}..${sep}${basename(root)}${sep}`;
    const [first, second] = await Promise.all([openSession(alias, options), openSession(root, options)]);
    expect(first).toBe(second);
    expect(first.projectRoot).toBe(root);
    expect(getSession(alias)).toBe(first);
    expect(scan).toHaveBeenCalledExactlyOnceWith(root, options.generationOptions);
  });

  test("filesystem roots stay intact without requiring an existing project directory", async () => {
    const filesystemRoot = parse(tmpdir()).root;
    const session = await openSession(filesystemRoot, options);
    expect(session.projectRoot).toBe(filesystemRoot);
    expect(getSession(filesystemRoot)).toBe(session);
    expect(getSession(".")).toBeNull();
    expect(scan).toHaveBeenCalledExactlyOnceWith(filesystemRoot, options.generationOptions);
  });

  test("the first opener's configuration owns a shared opening", async () => {
    const [first, second] = await Promise.all([
      openSession(root, { ...options, watchDebounceMs: 75 }),
      openSession(root, { ...options, watchDebounceMs: 250 }),
    ]);
    expect(first).toBe(second);
    expect(first.settings().watchDebounceMs).toBe(75);
  });
});
