import type { ICompleteProjectSnapshot, IProjectSnapshot } from "../../../contracts/interfaces/core/project-state.interface.js";
import type { ProjectId, SnapshotId } from "../../../contracts/interfaces/core/stable-ids.interface.js";

interface IProjectRow { project_id: string; root_path: string; active_snapshot_id: string | null; revision: number; }
/** Minimal database surface required by the project state repository. */
export interface IProjectDatabase { query(sql: string): { get(...parameters: unknown[]): unknown }; prepare(sql: string): { run(...parameters: unknown[]): unknown }; }

/** Repositorio SQLite para proyectos, revisiones y snapshot activo. */
export class SqliteProjectRepository {
  public constructor(private readonly database: IProjectDatabase) {}

  public ensure(projectId: ProjectId, rootPath: string, now: string): void {
    this.database.prepare("INSERT INTO projects (project_id, root_path, revision, created_at, updated_at) VALUES (?, ?, 0, ?, ?) ON CONFLICT(project_id) DO NOTHING").run(projectId.value, rootPath, now, now);
  }

  public getActive(projectId: ProjectId, snapshots: { get(id: SnapshotId): IProjectSnapshot | null }): ICompleteProjectSnapshot | null {
    const row = this.database.query("SELECT active_snapshot_id FROM projects WHERE project_id = ?").get(projectId.value) as { active_snapshot_id: string | null } | null;
    if (row === null || row.active_snapshot_id === null) return null;
    const snapshot = snapshots.get({ kind: "snapshot", value: row.active_snapshot_id });
    return snapshot?.status === "complete" ? snapshot as ICompleteProjectSnapshot : null;
  }

  public history(projectId: ProjectId, snapshots: { list(id: ProjectId): ReadonlyArray<IProjectSnapshot> }): ReadonlyArray<IProjectSnapshot> { return snapshots.list(projectId); }

  public activate(projectId: ProjectId, snapshot: IProjectSnapshot, expectedRevision: number, now: string): boolean {
    const result = this.database.prepare(
      "UPDATE projects SET active_snapshot_id = ?, revision = revision + 1, updated_at = ? WHERE project_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM snapshots WHERE snapshot_id = ? AND project_id = ? AND status = 'complete')",
    ).run(snapshot.snapshotId.value, now, projectId.value, expectedRevision, snapshot.snapshotId.value, projectId.value) as { changes?: number };
    return result.changes === 1;
  }

  public read(projectId: ProjectId): IProjectRow | null { return (this.database.query("SELECT project_id, root_path, active_snapshot_id, revision FROM projects WHERE project_id = ?").get(projectId.value) as IProjectRow | null); }
}
