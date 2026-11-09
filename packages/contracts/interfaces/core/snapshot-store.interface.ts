import type {
  ICompleteProjectSnapshot,
  IProjectSnapshot,
} from "./project-state.interface.js";
import type { ProjectId, SnapshotId } from "./stable-ids.interface.js";

export interface ISnapshotStore {
  save(snapshot: IProjectSnapshot): Promise<void>;
  get(snapshotId: SnapshotId): Promise<IProjectSnapshot | null>;
  getActive(projectId: ProjectId): Promise<ICompleteProjectSnapshot | null>;
  activate(snapshot: ICompleteProjectSnapshot): Promise<void>;
}