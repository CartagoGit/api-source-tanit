import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { migrateStateDatabase } from "../../../../packages/core/state/sqlite/migrations.js";
import { SqliteProjectRepository } from "../../../../packages/core/state/sqlite/sqlite-project.repository.js";
import { SqliteSnapshotRepository } from "../../../../packages/core/state/sqlite/sqlite-snapshot.repository.js";
import { SnapshotActivationService } from "../../../../packages/core/state/snapshot-activation.service.js";
import { SnapshotTransactionService } from "../../../../packages/core/state/snapshot-transaction.service.js";
const snapshot = (suffix: string, status: "building" | "complete" = "building") => ({ snapshotId: { kind: "snapshot" as const, value: `snapshot-${suffix}` }, projectId: { kind: "project" as const, value: "project-demo" }, status, revision: Number(suffix) || 1, capturedAt: "2026-09-08T00:00:00.000Z", services: [{ serviceId: { kind: "service" as const, value: "service-api" }, name: "API", operations: [{ operationId: { kind: "operation" as const, value: "operation-get" }, method: "GET", path: "/users", authRef: { kind: "auth" as const, value: "auth-profile" } }] }], diagnostics: [], metadata: { authorization: "Bearer secret", note: "kept" } });

const database = () => { const db = new Database(":memory:"); migrateStateDatabase(db); db.exec("INSERT INTO projects (project_id, root_path, created_at, updated_at) VALUES ('project-demo', '/tmp/demo', 'now', 'now')"); return db; };

describe("sqlite snapshot repository", () => {
  it("writes atomically, reads after restart, and does not persist secrets", () => {
    const db = database(); const repository = new SqliteSnapshotRepository(db); const service = new SnapshotTransactionService(db, repository);
    const complete = service.write(snapshot("1"));
    expect(repository.get(complete.snapshotId)?.status).toBe("complete");
    expect((db.query("SELECT status, digest FROM snapshots").all() as unknown[]).length).toBe(1);
    const metadata = db.query("SELECT metadata_json FROM snapshots").get() as { metadata_json: string | null };
    expect(metadata.metadata_json?.includes("secret")).toBe(false);
    const restarted = new SqliteSnapshotRepository(db); expect(restarted.get(complete.snapshotId)?.services[0]?.operations[0]?.path).toBe("/users");
    db.close();
  });

  it("keeps complete snapshots immutable and rolls back failed writes", () => {
    const db = database(); const repository = new SqliteSnapshotRepository(db); const service = new SnapshotTransactionService(db, repository); const complete = service.write(snapshot("1"));
    const projects = new SqliteProjectRepository(db);
    const activation = new SnapshotActivationService(projects, () => "2026-09-08T00:00:00.000Z");
    activation.activate(complete.projectId, complete, 0);
    const failed = snapshot("2");
    expect(() => service.write(failed, () => { throw new Error("scan failed"); })).toThrow("scan failed");
    const digest = db.query("SELECT digest FROM snapshots WHERE snapshot_id = ?").get(complete.snapshotId.value) as { digest: string | null };
    expect(typeof digest.digest).toBe("string");
    expect(repository.list(complete.projectId).length).toBe(1);
    expect(projects.getActive(complete.projectId, repository)?.snapshotId).toEqual(complete.snapshotId);
    db.close();
  });
});