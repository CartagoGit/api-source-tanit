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

/** Emitted once when the session releases its resources and identity. */
export interface SessionClosedEvent {
  readonly sessionId: string;
  readonly projectRoot: string;
}

export interface ISessionEventMap {
  "snapshot-ready": SnapshotReadyEvent;
  "snapshot-stale": SnapshotStaleEvent;
  "session-closed": SessionClosedEvent;
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

/** Serializable effective session settings shared by every presentation adapter. */
export interface IProjectSessionSettings extends
  Required<Pick<IProjectSessionOptions, "watch" | "watchDebounceMs">>,
  Pick<IGenerationOptions, "collectionName"> {}

export interface IProjectSession {
  readonly id: string;
  readonly projectRoot: string;
  current(): IProjectSnapshot;
  settings(): IProjectSessionSettings;
  configure(
    patch: Partial<IProjectSessionSettings>,
    signal?: IProjectSessionOptions["signal"],
  ): Promise<IProjectSessionSettings>;
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
