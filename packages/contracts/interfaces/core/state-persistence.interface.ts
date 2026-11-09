import type { ICompleteProjectSnapshot, IProjectSnapshot } from "./project-state.interface.js";
import type { ProjectId, SnapshotId } from "./stable-ids.interface.js";

export interface IShadowWriteDiagnostic {
  readonly ok: boolean;
  readonly enabled: boolean;
  readonly persisted: boolean;
  readonly activated: false;
  readonly snapshotId: string;
  readonly error?: string;
}

export interface IShadowProjectRepository {
  ensure(projectId: ProjectId, rootPath: string, now: string): void;
}

export interface IShadowTransactionService {
  write(snapshot: IProjectSnapshot): IProjectSnapshot;
}

export interface ITransactionDatabase {
  exec(sql: string): void;
}

export type StateParityStatus = "match" | "mismatch" | "unavailable";

export interface IStateParityDiagnostic {
  readonly status: StateParityStatus;
  readonly projectId: string;
  readonly snapshotId: string;
  readonly memoryDigest: string;
  readonly sqliteDigest: string | null;
  readonly message: string;
}

export interface IParitySnapshotRepository {
  get(snapshotId: SnapshotId): IProjectSnapshot | null;
}

export interface IStateDatabaseConnection<TDatabase = unknown> {
  readonly path: string;
  readonly version: number;
  readonly database: TDatabase;
  close(): void;
}

export interface IProjectDatabase {
  query(sql: string): { get(...parameters: unknown[]): unknown };
  prepare(sql: string): { run(...parameters: unknown[]): unknown };
}

export interface IQueryDatabase {
  query(sql: string): { get(...parameters: unknown[]): unknown; all(...parameters: unknown[]): unknown[] };
  prepare(sql: string): { run(...parameters: unknown[]): unknown };
}

export interface IStateMigrationDatabase {
  exec(sql: string): void;
  query(sql: string): { get(): unknown; all?(): unknown[] };
}

export interface IStateMigration {
  readonly version: number;
  readonly up: (database: IStateMigrationDatabase) => void;
  readonly down: (database: IStateMigrationDatabase) => void;
}

export type CompleteSnapshot = ICompleteProjectSnapshot;
