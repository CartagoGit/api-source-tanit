import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { migrateStateDatabase } from "../../../../packages/core/state/sqlite/migrations.js";
import { SqliteSnapshotRepository } from "../../../../packages/core/state/sqlite/sqlite-snapshot.repository.js";
import { SnapshotTransactionService } from "../../../../packages/core/state/snapshot-transaction.service.js";

describe("snapshot crash recovery", () => {
  it("does not expose a building snapshot as active state", () => {
    const db = new Database(":memory:"); migrateStateDatabase(db); db.exec("INSERT INTO projects (project_id, root_path, created_at, updated_at) VALUES ('p', '/tmp/p', 'now', 'now')");
    const repository = new SqliteSnapshotRepository(db as never); const service = new SnapshotTransactionService(db as never, repository); const id = { kind: "snapshot" as const, value: "building-1" };
    db.exec("BEGIN IMMEDIATE"); repository.insertBuilding({ snapshotId: id, projectId: { kind: "project", value: "p" }, status: "building", revision: 1, capturedAt: "now", services: [], diagnostics: [] }); db.exec("ROLLBACK");
    expect(repository.get(id)).toBe(null);
    expect(typeof service.fail).toBe("function"); service.fail(id, "crash before commit"); expect(repository.get(id)).toBe(null); db.close();
  });
});
