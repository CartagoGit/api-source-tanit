/**
 * Tests for ProjectSession (f00016 S1).
 *
 * Uses a synthetic `IGenerationOptions` with a stub orchestrator so these
 * tests never touch the filesystem of a real project.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import {
  openSession,
  getSession,
  closeAllSessions,
  type IProjectSessionOptions,
} from "../../../packages/core/session/project-session.service.js";
import { SessionAbortedError, SessionClosedError } from "../../../packages/core/session/session-error.js";
import type { IGenerationOptions } from "../../../packages/contracts/interfaces/core/discovery.interface.js";
import type { IDiscoveryOrchestrator } from "../../../packages/contracts/interfaces/core/scanner.interface.js";

// ── Synthetic orchestrator ────────────────────────────────────────────────────

let fakeProjectRoot: string;

function makeStubOrchestrator(): IDiscoveryOrchestrator {
  return {
    detectProject: vi.fn().mockResolvedValue({
      match: null,
      scanner: null,
      validation: null,
    }),
    detectAll: vi.fn().mockResolvedValue([]),
  };
}

function makeOptions(
  extra: Partial<IProjectSessionOptions> = {},
): IProjectSessionOptions {
  return {
    generationOptions: {
      orchestrator: makeStubOrchestrator(),
    } satisfies IGenerationOptions,
    ...extra,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  closeAllSessions();
});

beforeEach(async () => {
  fakeProjectRoot = await mkdtemp(join(tmpdir(), "tanit-session-"));
});

afterEach(async () => {
  closeAllSessions();
  await rm(fakeProjectRoot, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ProjectSession — open / snapshot", () => {
  test("open returns a session with a non-empty id", async () => {
    const session = await openSession(fakeProjectRoot, makeOptions());
    expect(session.id).toBeTruthy();
    expect(session.id).toContain("session:");
  });

  test("snapshot has the correct projectRoot", async () => {
    const session = await openSession(fakeProjectRoot, makeOptions());
    const snap = session.current();
    expect(snap.projectRoot).toBe(fakeProjectRoot);
  });

  test("snapshot.capturedAt is close to now", async () => {
    const before = Date.now();
    const session = await openSession(fakeProjectRoot, makeOptions());
    const after = Date.now();
    const snap = session.current();
    expect(snap.capturedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(snap.capturedAt.getTime()).toBeLessThanOrEqual(after);
  });

  test("snapshot is immutable (Object.isFrozen)", async () => {
    const session = await openSession(fakeProjectRoot, makeOptions());
    const snap = session.current();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.results)).toBe(true);
    expect(Object.isFrozen(snap.diagnostics)).toBe(true);
    expect(Object.isFrozen(snap.frameworks)).toBe(true);
  });
});

describe("ProjectSession — idempotency", () => {
  test("second open() for same root returns the existing session", async () => {
    const s1 = await openSession(fakeProjectRoot, makeOptions());
    const s2 = await openSession(fakeProjectRoot, makeOptions());
    expect(s1.id).toBe(s2.id);
  });

  test("getSession returns the open session", async () => {
    const s1 = await openSession(fakeProjectRoot, makeOptions());
    const found = getSession(fakeProjectRoot);
    expect(found?.id).toBe(s1.id);
  });

  test("getSession returns null when no session is open", () => {
    expect(getSession(fakeProjectRoot)).toBeNull();
  });
});

describe("ProjectSession — close", () => {
  test("current() throws SessionClosedError after close()", async () => {
    const session = await openSession(fakeProjectRoot, makeOptions());
    session.close();
    expect(() => session.current()).toThrow(SessionClosedError);
  });

  test("close() removes the session from the registry", async () => {
    const session = await openSession(fakeProjectRoot, makeOptions());
    session.close();
    expect(getSession(fakeProjectRoot)).toBeNull();
  });

  test("getSession returns null after close", async () => {
    const session = await openSession(fakeProjectRoot, makeOptions());
    session.close();
    expect(getSession(fakeProjectRoot)).toBeNull();
  });
});

describe("ProjectSession — AbortSignal", () => {
  test("throws SessionAbortedError when signal is already aborted", async () => {
    const alreadyAborted = { aborted: true } as const;
    await expect(
      openSession(fakeProjectRoot, makeOptions({ signal: alreadyAborted })),
    ).rejects.toThrow(SessionAbortedError);
  });

  test("does not throw when signal is not aborted", async () => {
    const notAborted = { aborted: false } as const;
    const session = await openSession(
      fakeProjectRoot,
      makeOptions({ signal: notAborted }),
    );
    expect(session).toBeDefined();
  });
});

describe("ProjectSession — events", () => {
  test("on/off subscribe and unsubscribe without errors", async () => {
    const session = await openSession(fakeProjectRoot, makeOptions());
    const handler = vi.fn();
    session.on("snapshot-ready", handler);
    session.off("snapshot-ready", handler);
    // No assertion needed: the API must not throw.
  });
});

describe("closeAllSessions", () => {
  test("resets the registry", async () => {
    await openSession(fakeProjectRoot, makeOptions());
    closeAllSessions();
    expect(getSession(fakeProjectRoot)).toBeNull();
  });
});
