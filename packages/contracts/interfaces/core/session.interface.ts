import type { IGenerationOptions, IGenerationResult } from "./discovery.interface.js";
import type { IDetectorDiagnostic } from "./scanner.interface.js";

export interface IProjectSnapshot {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly capturedAt: Date;
  readonly results: ReadonlyArray<IGenerationResult>;
  readonly diagnostics: ReadonlyArray<IDetectorDiagnostic>;
  readonly frameworks: ReadonlyArray<string>;
}

export interface SnapshotReadyEvent {
  readonly snapshot: IProjectSnapshot;
}

export interface SnapshotStaleEvent {
  readonly changedPaths: ReadonlyArray<string>;
}

export interface ISessionEventMap {
  "snapshot-ready": SnapshotReadyEvent;
  "snapshot-stale": SnapshotStaleEvent;
}

export type SessionEventName = keyof ISessionEventMap;
export type SessionEventPayload<K extends SessionEventName> = ISessionEventMap[K];

interface IAbortSignal {
  readonly aborted: boolean;
}

export interface IProjectSessionOptions {
  readonly signal?: IAbortSignal;
  readonly generationOptions: IGenerationOptions;
  readonly watch?: boolean;
  readonly watchDebounceMs?: number;
}

export interface IProjectSession {
  readonly id: string;
  readonly projectRoot: string;
  current(): IProjectSnapshot;
  on<K extends SessionEventName>(
    event: K,
    handler: (payload: SessionEventPayload<K>) => void,
  ): void;
  off<K extends SessionEventName>(
    event: K,
    handler: (payload: SessionEventPayload<K>) => void,
  ): void;
  close(): void;
}
