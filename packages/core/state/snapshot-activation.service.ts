import type { ICompleteProjectSnapshot } from "../../contracts/interfaces/core/project-state.interface.js";
import type { ProjectId } from "../../contracts/interfaces/core/stable-ids.interface.js";
import { SqliteProjectRepository } from "./sqlite/sqlite-project.repository.js";

export class SnapshotActivationConflictError extends Error { public constructor() { super("Snapshot activation lost its revision race"); this.name = "SnapshotActivationConflictError"; } }

export class SnapshotActivationService {
  public constructor(private readonly projects: SqliteProjectRepository, private readonly now: () => string = () => new Date().toISOString()) {}

  public activate(projectId: ProjectId, snapshot: ICompleteProjectSnapshot, expectedRevision: number): void {
    if (snapshot.status !== "complete") throw new Error("Only complete snapshots can be activated");
    if (!this.projects.activate(projectId, snapshot, expectedRevision, this.now())) throw new SnapshotActivationConflictError();
  }
}
