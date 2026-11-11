import { Injectable, inject } from "@angular/core";

import { HostBridgeClient } from "./host-bridge.client";
import type { ISessionEvent } from "../../../../../contracts/interfaces/core/history.interface";
import type {
  HistoryCompareConfigOutput,
  HistoryDiffOutput,
  HistoryListOutput,
  HistoryReExportOutput,
  HistoryRestoreOutput,
} from "../../../../../contracts/interfaces/core/application-api.interface";

/**
 * The history of a project.
 *
 * Two things live here, and they are not the same:
 *
 *   · the **session's events** — the snapshot was taken, the files
 *     under it changed. They are what happens while the project is
 *     open;
 *   · the **persisted history** — the revisions the project has been
 *     through, with their hashes, that can be compared, exported
 *     again or restored.
 *
 * The second one used to be asked for as a *pending* operation: the
 * call went out with a name the dispatcher did not know, and the
 * answer was `UNKNOWN_HANDLER`. Now there are handlers, and the
 * history is on disk (`~/.tanit/history/`), so a revision survives
 * the session that made it.
 */
@Injectable({ providedIn: "root" })
export class HistoryClient {
  private readonly bridge = inject(HostBridgeClient);

  /** What happened to the open session. */
  async list(projectRoot: string): Promise<ReadonlyArray<ISessionEvent>> {
    const answer = (await this.bridge.request("history", { projectRoot })) as {
      readonly entries?: ReadonlyArray<ISessionEvent>;
    };
    return answer.entries ?? [];
  }

  /** The revisions the project has been through, newest first. */
  async revisions(projectRoot: string, limit?: number): Promise<HistoryListOutput> {
    return this.bridge.request("history-list", { projectRoot, limit });
  }

  /** What changed between two revisions. */
  compare(
    projectRoot: string,
    leftId: string,
    rightId: string,
  ): Promise<HistoryDiffOutput> {
    return this.bridge.request("history-diff", { projectRoot, leftId, rightId });
  }

  /** How two revisions were configured, side by side. */
  compareConfig(
    projectRoot: string,
    leftId: string,
    rightId: string,
  ): Promise<HistoryCompareConfigOutput> {
    return this.bridge.request("history-compare-config", { projectRoot, leftId, rightId });
  }

  /** Exporting a past revision again. */
  reExport(
    projectRoot: string,
    historyId: string,
    target?: string,
    outputDirectory?: string,
  ): Promise<HistoryReExportOutput> {
    return this.bridge.request("history-re-export", {
      projectRoot,
      historyId,
      target,
      outputDirectory,
    });
  }

  /** Restoring a past revision: its collection goes back to the project. */
  restore(
    projectRoot: string,
    historyId: string,
    collectionPath?: string,
  ): Promise<HistoryRestoreOutput> {
    return this.bridge.request("history-restore", {
      projectRoot,
      historyId,
      collectionPath,
    });
  }
}
