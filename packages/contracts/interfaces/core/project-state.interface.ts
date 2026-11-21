import type {
  AuthRef,
  OperationId,
  ProjectId,
  SchemaId,
  ServerRef,
  ServiceId,
  SnapshotId,
} from "./stable-ids.interface.js";

export type SnapshotStatus = "building" | "complete" | "failed";

export interface IStateService {
  readonly serviceId: ServiceId;
  readonly name: string;
  readonly operations: ReadonlyArray<IStateOperation>;
}

export interface IStateOperation {
  readonly operationId: OperationId;
  readonly method: string;
  readonly path: string;
  readonly serverRef?: ServerRef;
  readonly authRef?: AuthRef;
  readonly schemaId?: SchemaId;
}

export interface IStateDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "error";
}

export interface IProjectSnapshot {
  readonly snapshotId: SnapshotId;
  readonly projectId: ProjectId;
  readonly status: SnapshotStatus;
  readonly revision: number;
  readonly capturedAt: string;
  readonly services: ReadonlyArray<IStateService>;
  readonly diagnostics: ReadonlyArray<IStateDiagnostic>;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly failure?: string;
}

export type ICompleteProjectSnapshot = IProjectSnapshot & {
  readonly status: "complete";
  readonly failure?: never;
};

export interface IProjectState {
  readonly projectId: ProjectId;
  readonly activeSnapshotId?: SnapshotId;
  readonly revision: number;
  readonly snapshots: ReadonlyArray<IProjectSnapshot>;
}