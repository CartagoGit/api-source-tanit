import type { ISnapshotSummary } from "./application-api.interface.js";

export interface LiveChange {
  readonly kind: "added" | "modified" | "removed";
  readonly path: string;
}

/** Session events have one payload on HTTP and stdio. */
export interface ILiveEventIdentity {
  readonly subscriptionId: string;
  readonly sessionId: string;
  readonly projectRoot: string;
}

export type LiveEvent = ILiveEventIdentity & (
  | { readonly type: "snapshot-ready"; readonly summary: ISnapshotSummary;
      readonly changedPaths: ReadonlyArray<string>;
      /** Distinct source files contributing discovered routes. */
      readonly sourceFileCount: number }
  | { readonly type: "snapshot-error"; readonly message: string; readonly changedPaths: ReadonlyArray<string> }
  | { readonly type: "snapshot-stale"; readonly changedPaths: ReadonlyArray<string> }
  | { readonly type: "session-closed" | "subscription-closed" }
);

export type LiveEventSink = (event: LiveEvent) => void;
