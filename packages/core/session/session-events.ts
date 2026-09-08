/**
 * Event types emitted by `ProjectSession`.
 *
 * Consumers subscribe via `session.on(event, handler)`.
 */

import type { IProjectSnapshot } from "./project-snapshot.js";

/** A new snapshot is ready after a re-scan. */
export interface SnapshotReadyEvent {
  readonly snapshot: IProjectSnapshot;
}

/** The current snapshot is stale because a watched file changed. */
export interface SnapshotStaleEvent {
  readonly changedPaths: ReadonlyArray<string>;
}

/** The full event map for `ProjectSession`. */
export interface ISessionEventMap {
  "snapshot-ready": SnapshotReadyEvent;
  "snapshot-stale": SnapshotStaleEvent;
}

export type SessionEventName = keyof ISessionEventMap;
export type SessionEventPayload<K extends SessionEventName> =
  ISessionEventMap[K];
