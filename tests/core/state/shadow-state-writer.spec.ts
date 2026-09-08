import { describe, expect, it } from "vitest";
import type { IProjectSnapshot } from "../../../packages/contracts/interfaces/core/project-state.interface.js";
import { ShadowStateWriterService } from "../../../packages/core/state/shadow-state-writer.service.js";

const snapshot = (): IProjectSnapshot => ({
  projectId: { kind: "project", value: "project-1" },
  snapshotId: { kind: "snapshot", value: "snapshot-1" },
  status: "building",
  revision: 1,
  capturedAt: "2026-09-09T00:00:00.000Z",
  services: [],
  diagnostics: [],
});

describe("shadow state writer", () => {
  it("does nothing when shadow persistence is disabled", () => {
    const result = new ShadowStateWriterService(null as never, null as never).write(snapshot(), "/tmp/project", false);
    expect(result).toEqual({ enabled: false, persisted: false, activated: false, ok: true, snapshotId: "snapshot-1" });
  });

  it("persists complete state without activation", () => {
    const writes: string[] = [];
    const result = new ShadowStateWriterService(
      { write: (value: IProjectSnapshot) => ({ ...value, status: "complete" as const }) } as never,
      { ensure: () => writes.push("ensure") },
    ).write(snapshot(), "/tmp/project", true);
    expect(result.ok).toBe(true);
    expect(result.persisted).toBe(true);
    expect(result.activated).toBe(false);
    expect(writes).toEqual(["ensure"]);
  });
});