/**
 * The services and the session history, against the real backend.
 *
 * Both used to promise more than the backend could answer: the
 * service list showed a base URL and an auth reference that no
 * handler returns, and the history showed generations with hashes
 * that the API's `history` handler does not have — it answers with
 * the **session's** events.
 *
 * These tests pin down what the app really gets.
 */
import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";

import { ServicesClient } from "../../packages/app/src/app/core/api/services.client";
import { HistoryClient } from "../../packages/app/src/app/core/api/history.client";
import { HostBridgeClient } from "../../packages/app/src/app/core/api/host-bridge.client";
import type { EndpointRecord } from "../../packages/app/src/app/core/api/endpoints.client";
import type { EndpointTransport } from "../../packages/contracts/interfaces/core/endpoint.interface";

/**
 * An endpoint with every field the contract declares.
 *
 * The contract says `method`, `path` and `description` are required:
 * an endpoint without them is not an endpoint the backend could ever
 * have sent, so a fixture that leaves them out is a fixture that
 * proves nothing.
 */
function endpoint(
  id: string,
  service: string,
  transport: EndpointTransport,
): EndpointRecord {
  return {
    id,
    operationId: id,
    service,
    transport,
    method: id.split(" ")[0] ?? "GET",
    path: id.split(" ")[1] ?? "/",
    description: "",
    responseSummary: "",
    responses: [],
    parameters: [],
  };
}

describe("ServicesClient", () => {
  it("reads the services the backend lists", async () => {
    const request = vi.fn(async (operation: string) => {
      if (operation === "list-services") {
        return {
          services: [
            { serviceId: "api", framework: "express", endpointCount: 12 },
            { serviceId: "admin", framework: "nestjs", endpointCount: 3 },
          ],
        };
      }
      throw new Error(`unexpected operation: ${operation}`);
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ServicesClient,
        { provide: HostBridgeClient, useValue: { request } },
      ],
    });
    const client = TestBed.inject(ServicesClient);

    const services = await client.list("/workspace");

    expect(services).toHaveLength(2);
    expect(services[0]).toEqual({ serviceId: "api", framework: "express", endpointCount: 12 });
  });

  it("counts the transports from the endpoints it already has", async () => {
    const request = vi.fn(async () => ({
      services: [{ serviceId: "api", framework: "express", endpointCount: 2 }],
    }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ServicesClient,
        { provide: HostBridgeClient, useValue: { request } },
      ],
    });
    const client = TestBed.inject(ServicesClient);

    const services = await client.listWithEndpoints("/workspace", [
      endpoint("GET /a", "api", "http"),
      endpoint("GET /b", "api", "grpc"),
    ]);

    expect(services[0]?.transports).toEqual(["grpc", "http"]);
    expect(services[0]?.operationCount).toBe(2);
  });

  it("asks the backend for the detail of one service", async () => {
    const request = vi.fn(async () => ({
      service: { serviceId: "api", framework: "express", endpointCount: 12, transports: ["http"] },
    }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [ServicesClient, { provide: HostBridgeClient, useValue: { request } }],
    });
    const client = TestBed.inject(ServicesClient);

    const detail = await client.detail("/workspace", "api");

    expect(request).toHaveBeenCalledWith("service-detail", {
      projectRoot: "/workspace",
      serviceId: "api",
    });
    expect(detail.endpointCount).toBe(12);
    expect(detail.framework).toBe("express");
  });
});

describe("HistoryClient", () => {
  it("reads the session's events", async () => {
    const request = vi.fn(async () => ({
      entries: [
        { kind: "snapshot-ready", capturedAt: "2026-10-31T10:00:00.000Z", sessionId: "s1" },
        { kind: "snapshot-stale", capturedAt: "2026-10-31T10:05:00.000Z", changedPaths: ["src/a.ts"] },
      ],
      total: 2,
    }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        HistoryClient,
        { provide: HostBridgeClient, useValue: { request } },
      ],
    });
    const client = TestBed.inject(HistoryClient);

    const entries = await client.list("/workspace");

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      kind: "snapshot-ready",
      capturedAt: "2026-10-31T10:00:00.000Z",
      sessionId: "s1",
    });
    expect(entries[1]?.changedPaths).toEqual(["src/a.ts"]);
  });

  it("asks the backend for the persisted revisions", async () => {
    const request = vi.fn(async (operation: string) => {
      if (operation === "history-list") {
        return { entries: [{ id: "a", timestamp: "2026-10-31T10:00:00.000Z", formats: ["postman"], count: 3, output: "/w/api.json", sha256: "ff", source: "export" }], total: 1 };
      }
      return {};
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [HistoryClient, { provide: HostBridgeClient, useValue: { request } }],
    });
    const client = TestBed.inject(HistoryClient);

    const revisions = await client.revisions("/workspace");

    expect(request).toHaveBeenCalledWith("history-list", { projectRoot: "/workspace", limit: undefined });
    expect(revisions.entries).toHaveLength(1);
    expect(revisions.entries[0]?.sha256).toBe("ff");
  });

  it("asks the backend to compare, re-export and restore", async () => {
    const request = vi.fn(async (_operation: string, _input: unknown) => ({}));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [HistoryClient, { provide: HostBridgeClient, useValue: { request } }],
    });
    const client = TestBed.inject(HistoryClient);

    await client.compare("/workspace", "a", "b");
    await client.compareConfig("/workspace", "a", "b");
    await client.reExport("/workspace", "a");
    await client.restore("/workspace", "a");

    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "history-diff",
      "history-compare-config",
      "history-re-export",
      "history-restore",
    ]);
  });
});
