import { Injectable } from "@angular/core";
import type { HostBridgeClient } from "./host-bridge.client";
import type {
  IHistoryConfiguration,
  IHistoryDiff,
  IHistoryEntry,
  IHistoryRestoreResult,
} from "../../../../../contracts/interfaces/core/history.interface";

/** What the history client needs from the connector. */
interface IHistoryBridge {
  request(operation: string, input: unknown): Promise<unknown>;
  requestPending(operation: string, input: unknown): Promise<unknown>;
}

export type { IHistoryChange, IHistoryConfiguration, IHistoryDiff, IHistoryEntry, IHistoryRestoreResult } from "../../../../../contracts/interfaces/core/history.interface";

@Injectable({ providedIn: "root" })
export class HistoryClient {
  private readonly historyBridge: IHistoryBridge;

  constructor(bridge: Pick<HostBridgeClient, "request" | "requestPending"> | IHistoryBridge) {
    this.historyBridge = bridge;
  }

  list(projectRoot: string): Promise<ReadonlyArray<IHistoryEntry>> {
    return this.historyBridge
      .request("history", { projectRoot })
      .then((result) => (result as { entries?: ReadonlyArray<IHistoryEntry> }).entries ?? []);
  }

  /**
   * Comparing two revisions, comparing their configuration, exporting
   * a past one again and restoring one are capabilities the core has
   * (`packages/core/session/history-recorder.service.ts`) but that no
   * handler exposes yet. They are asked for as pending, so the gap is
   * written down instead of turning into an `UNKNOWN_HANDLER` at
   * runtime.
   */
  compare(projectRoot: string, leftId: string, rightId: string, configuration?: IHistoryConfiguration): Promise<IHistoryDiff> {
    return this.historyBridge.requestPending("history-diff", { projectRoot, leftId, rightId, configuration }) as Promise<IHistoryDiff>;
  }

  compareConfig(projectRoot: string, leftId: string, rightId: string): Promise<IHistoryDiff["configuration"]> {
    return this.historyBridge.requestPending("history-compare-config", { projectRoot, leftId, rightId }) as Promise<IHistoryDiff["configuration"]>;
  }

  reExport(projectRoot: string, historyId: string, configuration: IHistoryConfiguration = {}): Promise<unknown> {
    return this.historyBridge.requestPending("history-re-export", { projectRoot, historyId, configuration });
  }

  restore(projectRoot: string, historyId: string): Promise<IHistoryRestoreResult> {
    return this.historyBridge.requestPending("history-restore", { projectRoot, historyId }) as Promise<IHistoryRestoreResult>;
  }
}