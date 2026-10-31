import { Injectable, inject } from "@angular/core";

import { HostBridgeClient } from "./host-bridge.client";
import type { ISessionEvent } from "../../../../../contracts/interfaces/core/history.interface";

/** What the API answered with, before it was read. */
interface IHistoryAnswer {
  readonly entries?: ReadonlyArray<
    | { readonly kind: "snapshot-ready"; readonly capturedAt: string; readonly sessionId: string }
    | { readonly kind: "snapshot-stale"; readonly capturedAt: string; readonly changedPaths: ReadonlyArray<string> }
  >;
}

@Injectable({ providedIn: "root" })
export class HistoryClient {
  private readonly bridge = inject(HostBridgeClient);

  /** What happened to the open session. */
  async list(projectRoot: string): Promise<ReadonlyArray<ISessionEvent>> {
    const answer = (await this.bridge.request("history", { projectRoot })) as IHistoryAnswer;
    return (answer.entries ?? []).map((entry) =>
      entry.kind === "snapshot-stale"
        ? {
            kind: entry.kind,
            capturedAt: entry.capturedAt,
            changedPaths: entry.changedPaths,
          }
        : {
            kind: entry.kind,
            capturedAt: entry.capturedAt,
            sessionId: entry.sessionId,
          },
    );
  }

  /**
   * Comparing two snapshots of the **persisted** history.
   *
   * The core can do it (`history-recorder.service.ts`), but no
   * handler exposes it yet, so the call is declared pending: it says
   * out loud that this does not work, instead of failing at runtime
   * with a name nobody recognizes.
   */
  compare(
    projectRoot: string,
    leftId: string,
    rightId: string,
    configuration?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.bridge.requestPending("history-diff", {
      projectRoot,
      leftId,
      rightId,
      configuration,
    });
  }

  /** The configuration two snapshots were made with. Pending, like the diff. */
  compareConfig(projectRoot: string, leftId: string, rightId: string): Promise<unknown> {
    return this.bridge.requestPending("history-compare-config", {
      projectRoot,
      leftId,
      rightId,
    });
  }

  /** Exporting a past snapshot again. Pending: no handler yet. */
  reExport(projectRoot: string, historyId: string, configuration?: Record<string, unknown>): Promise<unknown> {
    return this.bridge.requestPending("history-re-export", {
      projectRoot,
      historyId,
      configuration,
    });
  }

  /** Restoring a past snapshot. Pending: no handler yet. */
  restore(projectRoot: string, historyId: string): Promise<unknown> {
    return this.bridge.requestPending("history-restore", { projectRoot, historyId });
  }
}
