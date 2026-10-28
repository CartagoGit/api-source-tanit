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
