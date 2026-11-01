import type { ICanonicalSnapshot } from "./snapshot-hash.interface.js";

export interface IHistoryRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly formats: ReadonlyArray<string>;
  readonly count: number;
  readonly output: string;
  readonly sha256: string;
  readonly provenance: { readonly source: "scan" | "import" | "restore" | "export"; readonly projectRoot?: string; readonly parentId?: string };
  readonly snapshot: ICanonicalSnapshot;
  readonly configuration: Readonly<Record<string, unknown>>;
}

export type IHistoryEntry = IHistoryRecord;

/**
 * One thing that happened to the open session.
 *
 * The API's `history` handler answers with the session's own events:
 * the snapshot was taken, or the files it was built from changed.
 * That is what the app shows, and it is real.
 *
 * The **persisted** history — the generations of past runs, with
 * their hashes, that can be compared, re-exported or restored — is
 * a different thing: it lives in the user's history file, and no
 * handler exposes it yet.
 */
export interface ISessionEvent {
  readonly kind: "snapshot-ready" | "snapshot-stale";
  readonly capturedAt: string;
  readonly sessionId?: string;
  /** The files that changed, when the snapshot went stale. */
  readonly changedPaths?: ReadonlyArray<string>;
}

export interface IHistoryChange {
  readonly key: string;
  readonly serviceId: string;
  readonly operationId?: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface IHistoryDiff {
  readonly services: ReadonlyArray<string>;
  readonly operations: ReadonlyArray<string>;
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
  readonly changed: ReadonlyArray<string>;
  readonly schemaChanges: ReadonlyArray<IHistoryChange>;
  readonly authChanges: ReadonlyArray<IHistoryChange>;
  readonly serviceChanges: ReadonlyArray<IHistoryChange>;
  readonly operationChanges: ReadonlyArray<IHistoryChange>;
  readonly configuration?: { readonly before?: unknown; readonly after?: unknown };
}

export interface IHistoryConfiguration {
  readonly formats?: ReadonlyArray<string>;
  readonly outputDirectory?: string;
  readonly [key: string]: unknown;
}

export interface IHistoryRestoreResult {
  readonly restored: boolean;
  readonly historyId: string;
  readonly provenance: IHistoryEntry["provenance"];
  readonly settings?: unknown;
}
