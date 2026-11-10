import type { IProjectSnapshot } from "../../contracts/interfaces/core/project-state.interface.js";
import type { SnapshotId } from "../../contracts/interfaces/core/stable-ids.interface.js";
import { canonicalSnapshotDigest } from "./canonical-snapshot.serializer.js";
import type {
  IParitySnapshotRepository,
  IStateParityDiagnostic,
} from "../../contracts/interfaces/core/state-persistence.interface.js";

export type {
  IParitySnapshotRepository,
  IStateParityDiagnostic,
  StateParityStatus,
} from "../../contracts/interfaces/core/state-persistence.interface.js";

/** Compara el digest del snapshot en memoria con su copia durable. */
export class StateParityService {
  public constructor(private readonly snapshots: IParitySnapshotRepository) {}

  public compare(memory: IProjectSnapshot): IStateParityDiagnostic {
    const memoryDigest = canonicalSnapshotDigest(memory);
    let stored: IProjectSnapshot | null;
    try {
      stored = this.snapshots.get(memory.snapshotId);
    } catch (error) {
      return {
        status: "unavailable",
        projectId: memory.projectId.value,
        snapshotId: memory.snapshotId.value,
        memoryDigest,
        sqliteDigest: null,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (stored === null) {
      return {
        status: "unavailable",
        projectId: memory.projectId.value,
        snapshotId: memory.snapshotId.value,
        memoryDigest,
        sqliteDigest: null,
        message: "Snapshot is not available in SQLite",
      };
    }
    const sqliteDigest = canonicalSnapshotDigest(stored);
    return {
      status: memoryDigest === sqliteDigest ? "match" : "mismatch",
      projectId: memory.projectId.value,
      snapshotId: memory.snapshotId.value,
      memoryDigest,
      sqliteDigest,
      message: memoryDigest === sqliteDigest ? "Memory and SQLite snapshots match" : "Memory and SQLite snapshots differ",
    };
  }

  public compareActive(memory: IProjectSnapshot, activeSnapshotId: SnapshotId | null): IStateParityDiagnostic {
    if (activeSnapshotId === null || activeSnapshotId.value !== memory.snapshotId.value) {
      return {
        status: "mismatch",
        projectId: memory.projectId.value,
        snapshotId: memory.snapshotId.value,
        memoryDigest: canonicalSnapshotDigest(memory),
        sqliteDigest: null,
        message: "SQLite active snapshot differs from the in-memory snapshot",
      };
    }
    return this.compare(memory);
  }
}