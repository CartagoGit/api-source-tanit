import { describe, expect, it } from "vitest";

import type { IProjectSnapshot } from "../../../packages/contracts/interfaces/core/project-state.interface.js";
import { canonicalSnapshotDigest, canonicalSnapshotJson, parseCanonicalSnapshot, serializeCanonicalSnapshot } from "../../../packages/core/state/canonical-snapshot.serializer.js";
import { StableIdService } from "../../../packages/core/state/stable-id.service.js";

function snapshot(): IProjectSnapshot {
  const ids = new StableIdService();
  return {
    projectId: ids.project("project"),
    snapshotId: ids.snapshot("scan-1"),
    status: "complete",
    revision: 1,
    capturedAt: "2026-09-08T00:00:00.000Z",
    services: [
      {
        serviceId: ids.service("users"),
        name: "users",
        operations: [
          {
            operationId: ids.operation("users:get:/users"),
            method: "GET",
            path: "/users",
            authRef: ids.authRef("users-auth"),
          },
        ],
      },
    ],
    diagnostics: [],
    metadata: { apiKey: "do-not-persist", owner: "tanit" },
  };
}

describe("canonical snapshot serializer", () => {
  it("is deterministic and redacts secret values", () => {
    const first = snapshot();
    const second = { ...first, metadata: { owner: "tanit", apiKey: "another-secret" } };

    expect(canonicalSnapshotJson(first)).toBe(canonicalSnapshotJson(second));
    expect(canonicalSnapshotJson(first)).toContain("[REDACTED]");
    expect(canonicalSnapshotJson(first)).not.toContain("do-not-persist");
    expect(canonicalSnapshotDigest(first)).toBe(canonicalSnapshotDigest(second));
  });

  it("round-trips the canonical JSON", () => {
    const serialized = serializeCanonicalSnapshot(snapshot());
    const parsed = parseCanonicalSnapshot(serialized.json);

    expect(parsed).toEqual(serialized.snapshot);
    expect(canonicalSnapshotDigest(parsed)).toBe(serialized.digest);
  });
});