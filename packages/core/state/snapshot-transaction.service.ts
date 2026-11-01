import type { ICompleteProjectSnapshot, IProjectSnapshot } from "../../contracts/interfaces/core/project-state.interface.js";
import type { SnapshotId } from "../../contracts/interfaces/core/stable-ids.interface.js";
import { SqliteSnapshotRepository } from "./sqlite/sqlite-snapshot.repository.js";
import type { ITransactionDatabase } from "../../contracts/interfaces/core/state-persistence.interface.js";

export type { ITransactionDatabase } from "../../contracts/interfaces/core/state-persistence.interface.js";

/** Escribe snapshots completos dentro de una transacción SQLite. */
export class SnapshotTransactionService {
  public constructor(private readonly database: ITransactionDatabase, private readonly snapshots: SqliteSnapshotRepository) {}

  public write(snapshot: IProjectSnapshot, writeContents: (complete: ICompleteProjectSnapshot) => ICompleteProjectSnapshot = (complete) => complete): ICompleteProjectSnapshot {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.snapshots.insertBuilding(snapshot);
      const complete = writeContents({ ...snapshot, status: "complete", failure: undefined });
      this.snapshots.markComplete(complete);
      this.database.exec("COMMIT");
      return complete;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  public fail(snapshotId: SnapshotId, failure: string): void {
    this.database.exec("BEGIN IMMEDIATE");
    try { this.snapshots.markFailed(snapshotId, failure); this.database.exec("COMMIT"); } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
}
