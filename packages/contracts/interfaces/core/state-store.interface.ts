import type { IProjectState } from "./project-state.interface.js";
import type { ProjectId } from "./stable-ids.interface.js";

export interface IStateStore {
  load(projectId: ProjectId): Promise<IProjectState | null>;
  save(state: IProjectState): Promise<void>;
}