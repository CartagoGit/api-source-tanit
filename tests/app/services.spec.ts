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
        { provide: HostBridgeClient, useValue: { request, requestPending: vi.fn() } },
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
        { provide: HostBridgeClient, useValue: { request, requestPending: vi.fn() } },
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

  it("says that the detail is not exposed yet", async () => {
    const requestPending = vi.fn(async () => ({ service: { serviceId: "api" } }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ServicesClient,
        { provide: HostBridgeClient, useValue: { request: vi.fn(), requestPending } },
      ],
    });
    const client = TestBed.inject(ServicesClient);

    await client.detail("/workspace", "api");

    expect(requestPending).toHaveBeenCalledWith("service-detail", {
      projectRoot: "/workspace",
      serviceId: "api",
    });
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
        { provide: HostBridgeClient, useValue: { request, requestPending: vi.fn() } },
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

  it("asks for the persisted history as pending", async () => {
    const requestPending = vi.fn(async (_operation: string) => ({}));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        HistoryClient,
        { provide: HostBridgeClient, useValue: { request: vi.fn(), requestPending } },
      ],
    });
    const client = TestBed.inject(HistoryClient);

    await client.compare("/workspace", "a", "b");
    await client.compareConfig("/workspace", "a", "b");
    await client.reExport("/workspace", "a");
    await client.restore("/workspace", "a");

    expect(requestPending.mock.calls.map((call) => call[0])).toEqual([
      "history-diff",
      "history-compare-config",
      "history-re-export",
      "history-restore",
    ]);
  });
});
