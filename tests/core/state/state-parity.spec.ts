import { describe, expect, it } from "vitest";
import type { IProjectSnapshot } from "../../../packages/contracts/interfaces/core/project-state.interface.js";
import { StateParityService } from "../../../packages/core/state/state-parity.service.js";

const snapshot = (path = "/users"): IProjectSnapshot => ({
  projectId: { kind: "project", value: "project-1" },
  snapshotId: { kind: "snapshot", value: "snapshot-1" },
  status: "complete",
  revision: 1,
  capturedAt: "2026-09-09T00:00:00.000Z",
  services: [{ serviceId: { kind: "service", value: "service-1" }, name: "api", operations: [{ operationId: { kind: "operation", value: "operation-1" }, method: "GET", path }] }],
  diagnostics: [],
});

describe("state parity", () => {
  it("reports equal canonical memory and SQLite digests", () => {
    expect(new StateParityService({ get: () => snapshot() }).compare(snapshot()).status).toBe("match");
  });

  it("reports a structured mismatch and unavailable database", () => {
    expect(new StateParityService({ get: () => snapshot("/other") }).compare(snapshot()).status).toBe("mismatch");
    expect(new StateParityService({ get: () => null }).compare(snapshot()).status).toBe("unavailable");
  });
});