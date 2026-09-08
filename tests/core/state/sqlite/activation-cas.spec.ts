import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { migrateStateDatabase } from "../../../../packages/core/state/sqlite/migrations.js";
import { SqliteProjectRepository } from "../../../../packages/core/state/sqlite/sqlite-project.repository.js";
import { SqliteSnapshotRepository } from "../../../../packages/core/state/sqlite/sqlite-snapshot.repository.js";
import { SnapshotActivationConflictError, SnapshotActivationService } from "../../../../packages/core/state/snapshot-activation.service.js";
import { SnapshotTransactionService } from "../../../../packages/core/state/snapshot-transaction.service.js";

describe("snapshot activation CAS", () => {
  it("allows one writer for a revision and rejects the stale writer", () => {
    const db = new Database(":memory:"); migrateStateDatabase(db); db.exec("INSERT INTO projects (project_id, root_path, created_at, updated_at) VALUES ('p', '/tmp/p', 'now', 'now')");
    const snapshots = new SqliteSnapshotRepository(db as never); const transactions = new SnapshotTransactionService(db as never, snapshots); const project = new SqliteProjectRepository(db as never); const activation = new SnapshotActivationService(project, () => "2026-09-08T00:00:00.000Z");
    const first = transactions.write({ snapshotId: { kind: "snapshot", value: "s1" }, projectId: { kind: "project", value: "p" }, status: "building", revision: 1, capturedAt: "now", services: [], diagnostics: [] });
    const second = transactions.write({ ...first, snapshotId: { kind: "snapshot", value: "s2" }, revision: 2, status: "building" });
    activation.activate(first.projectId, first, 0); expect(() => activation.activate(second.projectId, second, 0)).toThrow(SnapshotActivationConflictError);
    expect(project.getActive(first.projectId, snapshots)?.snapshotId).toEqual(first.snapshotId); expect(project.read(first.projectId)?.revision).toBe(1); db.close();
  });

  it("rejects a missing snapshot without changing the project", () => {
    const db = new Database(":memory:"); migrateStateDatabase(db); db.exec("INSERT INTO projects (project_id, root_path, created_at, updated_at) VALUES ('p', '/tmp/p', 'now', 'now')");
    const project = new SqliteProjectRepository(db as never);
    const snapshot = { snapshotId: { kind: "snapshot" as const, value: "ghost" }, projectId: { kind: "project" as const, value: "p" }, status: "complete" as const, revision: 1, capturedAt: "now", services: [], diagnostics: [] };
    expect(project.activate(snapshot.projectId, snapshot, 0, "later")).toBe(false);
    expect(project.read(snapshot.projectId)?.active_snapshot_id).toBe(null); expect(project.read(snapshot.projectId)?.revision).toBe(0); db.close();
  });

  it("rejects a complete snapshot from another project", () => {
    const db = new Database(":memory:"); migrateStateDatabase(db); db.exec("INSERT INTO projects (project_id, root_path, created_at, updated_at) VALUES ('p', '/tmp/p', 'now', 'now'), ('other', '/tmp/other', 'now', 'now')");
    const snapshots = new SqliteSnapshotRepository(db as never); const transactions = new SnapshotTransactionService(db as never, snapshots); const project = new SqliteProjectRepository(db as never);
    const snapshot = transactions.write({ snapshotId: { kind: "snapshot", value: "other-snapshot" }, projectId: { kind: "project", value: "other" }, status: "building", revision: 1, capturedAt: "now", services: [], diagnostics: [] });
    expect(project.activate({ kind: "project", value: "p" }, snapshot, 0, "later")).toBe(false);
    expect(project.read({ kind: "project", value: "p" })?.active_snapshot_id).toBe(null); expect(project.read({ kind: "project", value: "p" })?.revision).toBe(0); db.close();
  });

  it("rejects a building snapshot", () => {
    const db = new Database(":memory:"); migrateStateDatabase(db); db.exec("INSERT INTO projects (project_id, root_path, created_at, updated_at) VALUES ('p', '/tmp/p', 'now', 'now')");
    const snapshots = new SqliteSnapshotRepository(db as never); const project = new SqliteProjectRepository(db as never);
    const snapshot = { snapshotId: { kind: "snapshot" as const, value: "snapshot-building" }, projectId: { kind: "project" as const, value: "p" }, status: "building" as const, revision: 1, capturedAt: "now", services: [], diagnostics: [] };
    snapshots.insertBuilding(snapshot);
    expect(project.activate(snapshot.projectId, snapshot as never, 0, "later")).toBe(false);
    expect(project.read(snapshot.projectId)?.active_snapshot_id).toBe(null); expect(project.read(snapshot.projectId)?.revision).toBe(0); db.close();
  });

  it("rejects a failed snapshot", () => {
    const db = new Database(":memory:"); migrateStateDatabase(db); db.exec("INSERT INTO projects (project_id, root_path, created_at, updated_at) VALUES ('p', '/tmp/p', 'now', 'now')");
    const snapshots = new SqliteSnapshotRepository(db as never); const project = new SqliteProjectRepository(db as never);
    const snapshot = { snapshotId: { kind: "snapshot" as const, value: "snapshot-failed" }, projectId: { kind: "project" as const, value: "p" }, status: "building" as const, revision: 1, capturedAt: "now", services: [], diagnostics: [] };
    snapshots.insertBuilding(snapshot); snapshots.markFailed(snapshot.snapshotId, "failed");
    expect(project.activate(snapshot.projectId, { ...snapshot, status: "failed", failure: "failed" } as never, 0, "later")).toBe(false);
    expect(project.read(snapshot.projectId)?.active_snapshot_id).toBe(null); expect(project.read(snapshot.projectId)?.revision).toBe(0); db.close();
  });
});
