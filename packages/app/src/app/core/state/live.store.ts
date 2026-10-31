import { Injectable, signal } from "@angular/core";
import type { HostBridgeClient } from "../api/host-bridge.client";

import type { LiveChange } from "../../../../../contracts/interfaces/core/live.interface";

export type { LiveChange } from "../../../../../contracts/interfaces/core/live.interface";

@Injectable({ providedIn: "root" })
export class LiveStore {
  readonly enabled = signal(false);
  readonly autoExport = signal(false);
  readonly sourceFileCount = signal(0);
  readonly changes = signal<ReadonlyArray<LiveChange>>([]);
  readonly error = signal<string | null>(null);

  private unsubscribe: (() => void) | null = null;
  private subscriptionId: string | null = null;

  constructor(private readonly bridge?: HostBridgeClient) {}

  connect(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.bridge?.subscribe((event) => this.update(event)) ?? null;
  }

  disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async setEnabled(value: boolean, projectRoot: string): Promise<void> {
    this.error.set(null);
    try {
      if (this.bridge) {
        if (value) {
          // `watch` subscribes; the answer carries the subscription the
          // backend keeps, and `cancel` is what ends it. The two are
          // separate operations in the Application API — turning the
          // toggle off is not "watch with enabled: false".
          const result = await this.bridge.request("watch", { projectRoot });
          this.subscriptionId = result.subscription.subscriptionId;
        } else if (this.subscriptionId !== null) {
          await this.bridge.request("cancel", { subscriptionId: this.subscriptionId });
          this.subscriptionId = null;
        }
      }
      this.enabled.set(value);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  setAutoExport(value: boolean): void {
    this.autoExport.set(value);
  }

  update(event: unknown): void {
    if (!event || typeof event !== "object") return;
    const value = event as { sourceFileCount?: unknown; changes?: unknown };
    if (typeof value.sourceFileCount === "number") this.sourceFileCount.set(value.sourceFileCount);
    if (Array.isArray(value.changes)) this.changes.set(value.changes as ReadonlyArray<LiveChange>);
  }
}