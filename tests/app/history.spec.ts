import { describe, expect, it, vi } from "vitest";
import { canonicalSnapshotJson, snapshotSha256, type ICanonicalSnapshot } from "../../packages/core/session/snapshot-hash.service";
import { diffSnapshots, HistoryRecorderService } from "../../packages/core/session/history-recorder.service";
import { HistoryClient } from "../../packages/app/src/app/core/api/history.client";

const snapshot: ICanonicalSnapshot = { capturedAt: "2026-09-08T00:00:00.000Z", formats: ["postman"], services: [{ serviceId: "api", framework: "express", transports: ["http"], auth: { kind: "bearer" }, operations: [{ operationId: "get-users", method: "GET", path: "/users", requestSchema: { type: "object" }, auth: { kind: "bearer" } }] }] };

describe("canonical history", () => {
  it("is stable and records SHA-256/count/provenance", () => {
    const recorder = new HistoryRecorderService();
    const entry = recorder.record("/workspace", snapshot, { output: "/tmp/out" });
    expect(entry.sha256).toBe(snapshotSha256(snapshot));
    expect(entry.count).toBe(1);
    expect(entry.provenance.source).toBe("scan");
    expect(recorder.serialize(entry)).toBe(canonicalSnapshotJson(snapshot));
  });

  it("diffs services and operations including schemas and auth", () => {
    const next: ICanonicalSnapshot = {
      ...snapshot,
      services: [{
        ...snapshot.services[0],
        auth: { kind: "api-key" },
        operations: [
          { operationId: "get-users", method: "GET", path: "/users", requestSchema: { type: "array" }, auth: { kind: "api-key" } },
          { operationId: "create-user", method: "POST", path: "/users", requestSchema: { type: "object" }, auth: { kind: "api-key" } },
        ],
      }],
    };
    const diff = diffSnapshots(snapshot, next);
    expect(diff.operations).toContain("operation:api/get-users");
    expect(diff.added).toContain("operation:api/create-user");
    expect(diff.authChanges).toContainEqual({ key: "service:api", serviceId: "api", before: { kind: "bearer" }, after: { kind: "api-key" } });
    expect(diff.authChanges).toContainEqual({ key: "operation:api/get-users", serviceId: "api", operationId: "get-users", before: { kind: "bearer" }, after: { kind: "api-key" } });
    expect(diff.schemaChanges).toContainEqual(expect.objectContaining({ key: "operation:api/get-users", before: { request: { type: "object" }, response: undefined }, after: { request: { type: "array" }, response: undefined } }));
  });

  it("records configuration and partial combined export provenance", () => {
    const recorder = new HistoryRecorderService();
    const entry = recorder.record("/workspace", { ...snapshot, combinedExport: { partial: true, explanation: "Service exporters differ", services: [{ serviceId: "api", reason: "missing operation references" }], operationRefs: { "api/get": { serverRef: "server-api" } } } }, { configuration: { formats: ["postman"] }, source: "export" });
    expect(entry.configuration).toEqual({ formats: ["postman"] });
    expect(entry.snapshot.combinedExport?.partial).toBe(true);
    expect(entry.snapshot.combinedExport?.operationRefs["api/get"]?.serverRef).toBe("server-api");
  });

  it("diffs the recorded configuration before and after", () => {
    const recorder = new HistoryRecorderService();
    const left = recorder.record("/workspace", snapshot, { configuration: { formats: ["postman"], outputDirectory: "/workspace/one" } });
    const right = recorder.record("/workspace", { ...snapshot, capturedAt: "2026-09-08T00:01:00.000Z" }, { configuration: { formats: ["openapi"], outputDirectory: "/workspace/two" } });
    expect(recorder.compare("/workspace", left.id, right.id).configuration).toEqual({
      before: { formats: ["postman"], outputDirectory: "/workspace/one" },
      after: { formats: ["openapi"], outputDirectory: "/workspace/two" },
    });
  });

  it("keeps divergent services scoped in detailed diffs", () => {
    const left: ICanonicalSnapshot = {
      ...snapshot,
      services: [
        snapshot.services[0],
        { serviceId: "admin", framework: "fastify", transports: ["http"], auth: { kind: "basic" }, baseUrl: "http://admin", operations: [] },
      ],
    };
    const right: ICanonicalSnapshot = {
      ...left,
      services: [
        { ...left.services[0], baseUrl: "http://api", auth: { kind: "api-key" } },
        { ...left.services[1], auth: { kind: "bearer" } },
      ],
    };
    const diff = diffSnapshots(left, right);
    expect(diff.serviceChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "service:api", serviceId: "api" }),
    ]));
    expect(diff.authChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "service:api", serviceId: "api" }),
      expect.objectContaining({ key: "service:admin", serviceId: "admin" }),
    ]));
  });

  it("passes compare config, export config, and restore provenance through the bridge", async () => {
    const bridge = { request: vi.fn()
      .mockResolvedValueOnce({ before: { formats: ["postman"] }, after: { formats: ["openapi"] } })
      .mockResolvedValueOnce({ output: "/workspace/out", configuration: { formats: ["postman"], outputDirectory: "/workspace/out" } })
      .mockResolvedValueOnce({ restored: true, historyId: "h1", provenance: { source: "restore", restoredFrom: "h1" }, settings: { formats: ["postman"] } }) };
      const client = new HistoryClient(bridge);

    await expect(client.compareConfig("/workspace", "h0", "h1")).resolves.toEqual({ before: { formats: ["postman"] }, after: { formats: ["openapi"] } });
    await expect(client.reExport("/workspace", "h1", { formats: ["postman"], outputDirectory: "/workspace/out" })).resolves.toMatchObject({ output: "/workspace/out" });
    await expect(client.restore("/workspace", "h1")).resolves.toMatchObject({ restored: true, provenance: { source: "restore", restoredFrom: "h1" } });
    expect(bridge.request).toHaveBeenNthCalledWith(1, "history-compare-config", { projectRoot: "/workspace", leftId: "h0", rightId: "h1" });
    expect(bridge.request).toHaveBeenNthCalledWith(2, "history-re-export", { projectRoot: "/workspace", historyId: "h1", configuration: { formats: ["postman"], outputDirectory: "/workspace/out" } });
    expect(bridge.request).toHaveBeenNthCalledWith(3, "history-restore", { projectRoot: "/workspace", historyId: "h1" });
  });
});