/**
 * The app's clients for the verbs that used to be CLI-only.
 *
 * ## What these tests are for
 *
 * `check`, `validate`, `stats`, `push` and `sync` had no handler, so
 * the app asked for them as **pending** operations and every screen
 * said "not available yet". The verbs moved to the core and the
 * Application API exposes them, so the app asks for them like any
 * other operation.
 *
 * These tests check the other half of that change: that the app asks
 * for the **real** operation, with the real input, and that it draws
 * the answer the backend gave — without inventing a field or
 * inventing a verdict.
 */
import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";

import { CheckClient } from "../../packages/app/src/app/core/api/check.client";
import { ValidateClient } from "../../packages/app/src/app/core/api/validate.client";
import { StatsClient } from "../../packages/app/src/app/core/api/stats.client";
import { SyncClient } from "../../packages/app/src/app/core/api/sync.client";
import { PushClient } from "../../packages/app/src/app/core/api/push.client";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";

/** A bridge that answers with what the backend really answers. */
function fakeBridge(): {
  bridge: { request: (operation: string, input: unknown) => Promise<unknown> };
  calls: Array<{ operation: string; input: unknown }>;
} {
  const calls: Array<{ operation: string; input: unknown }> = [];
  const bridge = {
    request: vi.fn(async (operation: string, input: unknown) => {
      calls.push({ operation, input });
      if (operation === "check") {
        return {
          report: {
            inSync: false,
            routesInSource: 12,
            requestsInCollection: 11,
            missingInCollection: [{ method: "GET", uri: "/api/users/{id}", name: "Get User" }],
            missingInSource: [],
            collectionPath: "/workspace/tanit/api.postman_collection.json",
          },
        };
      }
      if (operation === "validate") {
        return {
          result: {
            ok: true,
            errors: [],
            warnings: [{ severity: "warning", message: "info._postman_id is missing" }],
            requests: 11,
            folders: 3,
            variables: 5,
            collectionPath: "/workspace/tanit/api.postman_collection.json",
          },
        };
      }
      if (operation === "stats") {
        return {
          stats: {
            total: 11,
            byMethod: [{ method: "GET", count: 9 }, { method: "POST", count: 2 }],
            zones: [{ zone: "api", total: 11, byFolder: [{ folder: "Users", count: 11 }] }],
            collectionPath: "/workspace/tanit/api.postman_collection.json",
          },
        };
      }
      if (operation === "sync") {
        return {
          files: ["/workspace/tanit/api.postman_collection.json"],
          bytes: 4096,
          plannedFiles: [
            { path: "/workspace/tanit/api.postman_collection.json", change: "NEW", bytes: 4096 },
          ],
          endpointCount: 12,
          frameworks: ["express"],
          dryRun: false,
          diagnostics: [],
        };
      }
      if (operation === "push") {
        return {
          user: "someone",
          framework: "express",
          requests: 11,
          collection: { action: "created", uid: "1-2", name: "api" },
          environments: [{ action: "created", uid: "1-3", name: "Local" }],
          error: null,
          dryRun: false,
        };
      }
      throw new Error(`unexpected operation: ${operation}`);
    }),
  };
  return { bridge, calls };
}

/** A TestBed with the fake bridge in place. */
function withBridge<T>(client: new (...args: never[]) => T): {
  client: T;
  calls: Array<{ operation: string; input: unknown }>;
} {
  const { bridge, calls } = fakeBridge();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [client, { provide: HostBridgeClient, useValue: bridge }],
  });
  return { client: TestBed.inject(client), calls };
}

describe("the clients of the verbs that used to be CLI-only", () => {
  it("the check client asks for the real operation", async () => {
    const { client, calls } = withBridge(CheckClient);

    const report = await client.check("/workspace");

    expect(calls[0]?.operation).toBe("check");
    expect(calls[0]?.input).toMatchObject({ projectRoot: "/workspace" });
    expect(report.routesInSource).toBe(12);
    expect(report.missingInCollection[0]?.uri).toBe("/api/users/{id}");
  });

  it("the validate client draws the errors and the warnings apart", async () => {
    const { client, calls } = withBridge(ValidateClient);

    const result = await client.validate("/workspace");

    expect(calls[0]?.operation).toBe("validate");
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
  });

  it("the stats client draws the counts", async () => {
    const { client, calls } = withBridge(StatsClient);

    const stats = await client.stats("/workspace");

    expect(calls[0]?.operation).toBe("stats");
    expect(stats.total).toBe(11);
    expect(stats.byMethod.map((entry) => entry.method)).toEqual(["GET", "POST"]);
  });

  it("the sync client asks to write", async () => {
    const { client, calls } = withBridge(SyncClient);

    const result = await client.sync("/workspace");

    expect(calls[0]?.operation).toBe("sync");
    expect(calls[0]?.input).toMatchObject({ projectRoot: "/workspace" });
    expect(result.files).toHaveLength(1);
  });

  it("the sync client can ask for a preview instead", async () => {
    const { client, calls } = withBridge(SyncClient);

    await client.sync("/workspace", { dryRun: true, target: "postman" });

    expect(calls[0]?.input).toMatchObject({ dryRun: true, target: "postman" });
  });

  it("the push client sends the key, and does not expect it back", async () => {
    const { client, calls } = withBridge(PushClient);

    const result = await client.push({
      projectRoot: "/workspace",
      apiKey: "pmak-secret",
      workspace: "12345",
    });

    expect(calls[0]?.operation).toBe("push");
    expect(calls[0]?.input).toMatchObject({
      projectRoot: "/workspace",
      apiKey: "pmak-secret",
      workspaceId: "12345",
    });
    // The answer says what happened. It does not carry the key.
    expect(JSON.stringify(result)).not.toContain("pmak-secret");
  });

  it("the push client redacts a key that comes back inside an error", async () => {
    const { bridge } = fakeBridge();
    bridge.request = vi.fn(async () => {
      throw new Error("rate limit for pmak-abc123");
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [PushClient, { provide: HostBridgeClient, useValue: bridge }],
    });
    const client = TestBed.inject(PushClient);

    await expect(
      client.push({ projectRoot: "/workspace", apiKey: "pmak-secret" }),
    ).rejects.toThrow(/\[REDACTED\]/);
  });
});
