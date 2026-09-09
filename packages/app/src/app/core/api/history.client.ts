import { Injectable } from "@angular/core";
import type { HostBridgeClient } from "./host-bridge.client";
import type {
  IHistoryConfiguration,
  IHistoryDiff,
  IHistoryEntry,
  IHistoryRestoreResult,
} from "../../../../../contracts/interfaces/core/history.interface";

interface IHistoryBridge {
  request(operation: string, input: unknown): Promise<unknown>;
}

export type { IHistoryChange, IHistoryConfiguration, IHistoryDiff, IHistoryEntry, IHistoryRestoreResult } from "../../../../../contracts/interfaces/core/history.interface";

@Injectable({ providedIn: "root" })
export class HistoryClient {
  private readonly historyBridge: IHistoryBridge;

  constructor(bridge: Pick<HostBridgeClient, "request"> | IHistoryBridge) {
    this.historyBridge = bridge;
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