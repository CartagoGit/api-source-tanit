import { Injectable } from "@angular/core";
import { HostBridgeClient } from "./host-bridge.client";

interface IHistoryBridge {
  request(operation: string, input: unknown): Promise<unknown>;
}

export interface IHistoryEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly formats: ReadonlyArray<string>;
  readonly count: number;
  readonly output: string;
  readonly sha256: string;
  readonly provenance: { readonly source: string; readonly projectRoot?: string; readonly parentId?: string; readonly restoredFrom?: string };
  readonly configuration?: Readonly<Record<string, unknown>>;
}

export interface IHistoryChange {
  readonly key: string;
  readonly serviceId: string;
  readonly operationId?: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface IHistoryDiff {
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

@Injectable({ providedIn: "root" })
export class HistoryClient {
  private readonly historyBridge: IHistoryBridge;

  constructor(bridge: HostBridgeClient) {
    this.historyBridge = bridge as unknown as IHistoryBridge;
  }

  list(projectRoot: string): Promise<ReadonlyArray<IHistoryEntry>> {
    return this.historyBridge
      .request("history", { projectRoot })
      .then((result) => (result as { entries?: ReadonlyArray<IHistoryEntry> }).entries ?? []);
  }

  compare(projectRoot: string, leftId: string, rightId: string, configuration?: IHistoryConfiguration): Promise<IHistoryDiff> {
    return this.historyBridge.request("history-diff", { projectRoot, leftId, rightId, configuration }) as Promise<IHistoryDiff>;
  }

  compareConfig(projectRoot: string, leftId: string, rightId: string): Promise<IHistoryDiff["configuration"]> {
    return this.historyBridge.request("history-compare-config", { projectRoot, leftId, rightId }) as Promise<IHistoryDiff["configuration"]>;
  }

  reExport(projectRoot: string, historyId: string, configuration: IHistoryConfiguration = {}): Promise<unknown> {
    return this.historyBridge.request("history-re-export", { projectRoot, historyId, configuration });
  }

  restore(projectRoot: string, historyId: string): Promise<IHistoryRestoreResult> {
    return this.historyBridge.request("history-restore", { projectRoot, historyId }) as Promise<IHistoryRestoreResult>;
  }
}