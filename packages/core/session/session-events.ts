/**
 * Event types emitted by `ProjectSession`.
 *
 * Consumers subscribe via `session.on(event, handler)`.
 */

export type {
  ISessionEventMap,
  SessionEventName,
  SessionEventPayload,
  SnapshotReadyEvent,
  SnapshotStaleEvent,
} from "../../contracts/interfaces/core/session.interface.js";
