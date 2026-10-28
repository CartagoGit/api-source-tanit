import { describe, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { makeSnapshot } from "../../packages/core/session/project-snapshot.js";
import { closeAllSessions, getSession, openSession } from "../../packages/core/session/project-session.service.js";
import { generateCollections } from "../../packages/core/discovery/generation.pipeline.js";
import { readManifest } from "../../packages/core/index/manifest-reader.service.js";
import {
  canonicalSnapshotJson,
  snapshotHashFromJson,
  snapshotSha256,
} from "../../packages/core/session/snapshot-hash.service.js";
import { HistoryRecorderService } from "../../packages/core/session/history-recorder.service.js";
import type { ICanonicalSnapshot } from "../../packages/core/session/snapshot-hash.service.js";

const watchState = vi.hoisted(() => ({
  callback: null as ((eventType: string, filename: string) => void) | null,
}));

vi.mock("../../packages/core/discovery/generation.pipeline.js", () => ({
  generateCollections: vi.fn().mockResolvedValue([]),
}));

vi.mock("node:fs", () => ({
  watch: vi.fn((_path: string, _options: unknown, callback: (eventType: string, filename: string) => void) => {
    watchState.callback = callback;
    return { close: vi.fn() };
  }),
}));

function canonical(overrides: Partial<ICanonicalSnapshot> = {}): ICanonicalSnapshot {
  return {
    capturedAt: "2026-09-09T00:00:00.000Z",
    formats: ["postman"],
    services: [{
      serviceId: "api",
      framework: "express",
      transports: ["http"],
      auth: { kind: "bearer" },
      baseUrl: "http://api",
      operations: [{
        operationId: "get-users",
        method: "GET",
        path: "/users",
        requestSchema: { type: "object", properties: { id: { type: "string" } } },
        responseSchema: { type: "array" },
        auth: { kind: "bearer" },
      }],
    }],
    ...overrides,
  };
}

describe("project snapshots", () => {
  test("freezes arrays and derives unique frameworks", () => {
    const snapshot = makeSnapshot({
      sessionId: "session:1",
      projectRoot: "/project",
      results: [],
      diagnostics: [],
    });
    expect(snapshot.sessionId).toBe("session:1");
    expect(snapshot.projectRoot).toBe("/project");
    expect(snapshot.frameworks).toEqual([]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.results)).toBe(true);
    expect(Object.isFrozen(snapshot.diagnostics)).toBe(true);
  });
});

describe("snapshot hashing", () => {
  test("canonicalizes object key order but preserves array order", () => {
    const left = canonical({ services: [{ ...canonical().services[0]!, auth: { z: 1, a: 2 } }] });
    const right = canonical({ services: [{ ...canonical().services[0]!, auth: { a: 2, z: 1 } }] });
    expect(canonicalSnapshotJson(left)).toBe(canonicalSnapshotJson(right));
    expect(snapshotSha256(left)).toBe(snapshotSha256(right));
    expect(snapshotHashFromJson(canonicalSnapshotJson(left))).toBe(snapshotSha256(left));
    expect(snapshotSha256(canonical({ formats: ["openapi"] }))).not.toBe(snapshotSha256(left));
  });
});

describe("history recorder", () => {
  test("records sorted formats, counts operations, lists, gets, serializes, and compares", () => {
    const recorder = new HistoryRecorderService();
    const left = recorder.record("/project", canonical(), { formats: ["z", "a"], output: "/out/one", source: "scan", configuration: { mode: "one" } });
    const rightSnapshot = canonical({
      capturedAt: "2026-09-09T00:01:00.000Z",
      services: [
        { ...canonical().services[0]!, framework: "fastify", operations: [{ ...canonical().services[0]!.operations[0]!, method: "POST", requestSchema: { type: "string" }, auth: { kind: "apikey" } }, { operationId: "create-user", method: "POST", path: "/users", auth: null }] },
        { serviceId: "admin", framework: "express", transports: ["http"], auth: null, operations: [] },
      ],
    });
    const right = recorder.record("/project", rightSnapshot, { source: "export", parentId: left.id, configuration: { mode: "two" } });
    expect(left.formats).toEqual(["a", "z"]);
    expect(left.count).toBe(1);
    expect(right.provenance.parentId).toBe(left.id);
    expect(recorder.get("/project", left.id)).toBe(left);
    expect(recorder.get("/missing", left.id)).toBeUndefined();
    expect(recorder.list("/project").map((record) => record.id)).toEqual([right.id, left.id]);
    expect(recorder.list("/missing")).toEqual([]);
    expect(recorder.serialize(left)).toBe(canonicalSnapshotJson(left.snapshot));

    const diff = recorder.compare("/project", left.id, right.id);
    expect(diff.added).toEqual(["operation:api/create-user", "service:admin"]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toContain("service:api");
    expect(diff.changed).toContain("operation:api/get-users");
    expect(diff.schemaChanges.map((change) => change.key)).toEqual(["operation:api/get-users"]);
    expect(diff.authChanges.map((change) => change.key)).toEqual(["operation:api/get-users"]);
    expect(diff.serviceChanges.map((change) => change.key)).toEqual(["service:api"]);
    expect(diff.operationChanges.map((change) => change.key)).toEqual(["operation:api/get-users"]);
    expect(diff.configuration).toEqual({ before: { mode: "one" }, after: { mode: "two" } });
  });

  test("classifies removals and rejects comparisons with missing records", () => {
    const recorder = new HistoryRecorderService();
    const left = recorder.record("/project", canonical());
    const right = recorder.record("/project", canonical({ services: [] }));
    expect(recorder.compare("/project", left.id, right.id).removed).toEqual(["service:api"]);
    expect(() => recorder.compare("/project", left.id, "missing")).toThrow("Both history records are required");
  });
});

describe("session and manifest edge branches", () => {
  test("emits stale and ready events after a debounced watched change", async () => {
    const root = await mkdtemp(join(tmpdir(), "core-session-watch-"));
    try {
      const session = await openSession(root, {
        watch: true,
        watchDebounceMs: 1,
        generationOptions: {
          orchestrator: {
            detectAll: async () => [],
            detectAllWithDiagnostics: async () => ({ detected: [], diagnostics: [] }),
            forceFramework: async () => null,
            supportedFrameworks: () => [],
          },
        },
      });
      const stale = vi.fn();
      const ready = vi.fn();
      session.on("snapshot-stale", stale);
      session.on("snapshot-ready", ready);
      watchState.callback?.("change", "src/changed.ts");
      expect(stale).toHaveBeenCalledWith({ changedPaths: ["src/changed.ts"] });
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(ready).toHaveBeenCalledOnce();
      expect(getSession(root)?.id).toBe(session.id);
      session.close();
      expect(getSession(root)).toBeNull();
    } finally {
      closeAllSessions();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports an aborted scan after generation completes", async () => {
    const root = await mkdtemp(join(tmpdir(), "core-session-abort-"));
    const signal = { aborted: false };
    try {
      vi.mocked(generateCollections).mockImplementationOnce(async () => {
        signal.aborted = true;
        return [];
      });
      await expect(openSession(root, {
        signal,
        generationOptions: {
          orchestrator: {
            detectAll: async () => [],
            detectAllWithDiagnostics: async () => ({ detected: [], diagnostics: [] }),
            forceFramework: async () => null,
            supportedFrameworks: () => [],
          },
        },
      })).rejects.toThrow("was aborted");
    } finally {
      closeAllSessions();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reads TOML sections, quoted scalars, arrays, and text manifests", async () => {
    const root = await mkdtemp(join(tmpdir(), "core-manifest-"));
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(root, "pyproject.toml"), "[tool.poetry]\nname = \"demo\"\npackages = [\"demo\", \"shared\"]\n", "utf8");
      await writeFile(join(root, "Gemfile"), "source \"https://rubygems.org\"\n", "utf8");
      const toml = await readManifest({ projectRoot: root, relPath: "pyproject.toml" });
      expect(toml?.parsed).toEqual({ tool: { poetry: { name: "demo", packages: ["demo", "shared"] } } });
      const text = await readManifest({ projectRoot: root, relPath: "Gemfile" });
      expect(text?.format).toBe("text");
      expect(text?.parsed).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});