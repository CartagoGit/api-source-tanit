import type {
  ICompleteProjectSnapshot,
  IProjectSnapshot,
  IStateDiagnostic,
} from "../../../contracts/interfaces/core/project-state.interface.js";
import type { ProjectId, SnapshotId } from "../../../contracts/interfaces/core/stable-ids.interface.js";
import { canonicalSnapshotDigest, serializeCanonicalSnapshot } from "../canonical-snapshot.serializer.js";
import type { IQueryDatabase } from "../../../contracts/interfaces/core/state-persistence.interface.js";

export type { IQueryDatabase } from "../../../contracts/interfaces/core/state-persistence.interface.js";

interface ISnapshotRow {
  snapshot_id: string;
  project_id: string;
  status: IProjectSnapshot["status"];
  revision: number;
  captured_at: string;
  digest: string | null;
  metadata_json: string | null;
  failure: string | null;
}

const idValue = (id: { value: string }): string => id.value;
const parseJson = <T>(value: string | null, fallback: T): T => (value === null ? fallback : JSON.parse(value) as T);

/** Repositorio SQLite para snapshots en construcción, completos o fallidos. */
export class SqliteSnapshotRepository {
  public constructor(private readonly database: IQueryDatabase) {}

  public insertBuilding(snapshot: IProjectSnapshot): void {
    const canonical = serializeCanonicalSnapshot(snapshot).snapshot;
    this.database.prepare(
      "INSERT INTO snapshots (snapshot_id, project_id, status, revision, captured_at, digest, metadata_json, failure) VALUES (?, ?, 'building', ?, ?, NULL, ?, NULL)",
    ).run(idValue(snapshot.snapshotId), idValue(snapshot.projectId), snapshot.revision, snapshot.capturedAt, canonical.metadata === undefined ? null : JSON.stringify(canonical.metadata));
  }

  public markComplete(snapshot: ICompleteProjectSnapshot): void {
    const canonical = serializeCanonicalSnapshot(snapshot).snapshot as ICompleteProjectSnapshot;
    const result = this.database.prepare(
      "UPDATE snapshots SET status = 'complete', digest = ?, metadata_json = ?, failure = NULL WHERE snapshot_id = ? AND status = 'building'",
    ).run(canonicalSnapshotDigest(snapshot), canonical.metadata === undefined ? null : JSON.stringify(canonical.metadata), idValue(snapshot.snapshotId)) as { changes?: number };
    if (result.changes !== 1) throw new Error(`Snapshot ${idValue(snapshot.snapshotId)} is not building`);
    this.writeContents(snapshot);
  }

  public markFailed(snapshotId: SnapshotId, failure: string): void {
    this.database.prepare("UPDATE snapshots SET status = 'failed', failure = ? WHERE snapshot_id = ? AND status = 'building'").run(failure, idValue(snapshotId));
  }

  public get(snapshotId: SnapshotId): IProjectSnapshot | null {
    const row = this.database.query("SELECT * FROM snapshots WHERE snapshot_id = ?").get(idValue(snapshotId)) as ISnapshotRow | null;
    return row === null ? null : this.readSnapshot(row);
  }

  public list(projectId: ProjectId): ReadonlyArray<IProjectSnapshot> {
    const rows = this.database.query("SELECT * FROM snapshots WHERE project_id = ? ORDER BY revision DESC").all(idValue(projectId)) as ISnapshotRow[];
    return rows.map((row) => this.readSnapshot(row));
  }

  private writeContents(snapshot: ICompleteProjectSnapshot): void {
    const serviceStatement = this.database.prepare("INSERT INTO services (service_id, snapshot_id, name) VALUES (?, ?, ?)");
    const operationStatement = this.database.prepare("INSERT INTO operations (operation_id, snapshot_id, service_id, method, path, server_ref, auth_ref, schema_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const service of snapshot.services) {
      serviceStatement.run(idValue(service.serviceId), idValue(snapshot.snapshotId), service.name);
      for (const operation of service.operations) {
        operationStatement.run(idValue(operation.operationId), idValue(snapshot.snapshotId), idValue(service.serviceId), operation.method, operation.path, operation.serverRef?.value ?? null, operation.authRef?.value ?? null, operation.schemaId?.value ?? null);
      }
    }
    const diagnosticStatement = this.database.prepare("INSERT INTO diagnostics (snapshot_id, code, message, severity) VALUES (?, ?, ?, ?)");
    for (const diagnostic of snapshot.diagnostics) diagnosticStatement.run(idValue(snapshot.snapshotId), diagnostic.code, diagnostic.message, diagnostic.severity);
  }

  private readSnapshot(row: ISnapshotRow): IProjectSnapshot {
    const services = this.database.query("SELECT * FROM services WHERE snapshot_id = ? ORDER BY service_id").all(row.snapshot_id) as Array<{ service_id: string; name: string }>;
    const operations = this.database.query("SELECT * FROM operations WHERE snapshot_id = ? ORDER BY operation_id").all(row.snapshot_id) as Array<{ operation_id: string; service_id: string; method: string; path: string; server_ref: string | null; auth_ref: string | null; schema_id: string | null }>;
    const diagnostics = this.database.query("SELECT code, message, severity FROM diagnostics WHERE snapshot_id = ? ORDER BY diagnostic_id").all(row.snapshot_id) as IStateDiagnostic[];
    return {
      snapshotId: { kind: "snapshot", value: row.snapshot_id },
      projectId: { kind: "project", value: row.project_id },
      status: row.status,
      revision: row.revision,
      capturedAt: row.captured_at,
      metadata: parseJson(row.metadata_json, undefined),
      failure: row.failure ?? undefined,
      diagnostics,
      services: services.map((service) => ({
        serviceId: { kind: "service", value: service.service_id },
        name: service.name,
        operations: operations.filter((operation) => operation.service_id === service.service_id).map((operation) => ({
          operationId: { kind: "operation", value: operation.operation_id },
          method: operation.method,
          path: operation.path,
          ...(operation.server_ref === null ? {} : { serverRef: { kind: "server" as const, value: operation.server_ref } }),
          ...(operation.auth_ref === null ? {} : { authRef: { kind: "auth" as const, value: operation.auth_ref } }),
          ...(operation.schema_id === null ? {} : { schemaId: { kind: "schema" as const, value: operation.schema_id } }),
        })),
      })),
    };
  }
}
