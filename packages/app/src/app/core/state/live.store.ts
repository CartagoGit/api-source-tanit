import { Injectable, effect, inject, signal } from "@angular/core";

import { HostBridgeClient } from "../api/host-bridge.client";
import { ProjectStore } from "./project.store";
import type { LiveChange } from "../../../../../contracts/interfaces/core/live.interface";

export type { LiveChange } from "../../../../../contracts/interfaces/core/live.interface";

/**
 * The live mode: the backend watches the sources and pushes what
 * changed.
 *
 * ## What was broken
 *
 * Two faults, and together they made the section dead:
 *
 *   · The connector was a **constructor parameter typed as an
 *     interface**, imported with `import type`. Angular cannot
 *     inject a type that has no value at runtime, so `this.bridge`
 *     was `undefined` and every `if (this.bridge)` was false. The
 *     toggle moved a signal and nothing else: no watch was
 *     subscribed, and the "cancel" that ends it was never sent.
 *   · `connect()` was **never called** by anybody. The store
 *     subscribed to nothing, so even a working connector would have
 *     delivered its events into an empty set of listeners. The
 *     screen said "watching 0 files" and would have said it forever.
 *
 * ## What it does now
 *
 * The connector is injected the way the other stores inject theirs,
 * and the store subscribes when it is built. Turning the toggle on
 * asks the backend for a `watch` subscription; turning it off sends
 * the `cancel` that ends it. Both are real handlers.
 */
@Injectable({ providedIn: "root" })
export class LiveStore {
  readonly enabled = signal(false);
  readonly autoExport = signal(false);
  readonly sourceFileCount = signal(0);
  readonly changes = signal<ReadonlyArray<LiveChange>>([]);
  readonly error = signal<string | null>(null);
  /** The subscription the backend keeps, while there is one. */
  readonly subscriptionId = signal<string | null>(null);

  private readonly bridge = inject(HostBridgeClient);
  private readonly project = inject(ProjectStore);
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.connect();
    // The subscription belongs to **a** project. When the open
    // project changes, the backend would keep watching the previous
    // one — the events would arrive, and they would be about a
    // project that is no longer open.
    let previous: string | null | undefined;
    effect(() => {
      const root = this.project.projectRoot();
      if (root === previous) return;
      previous = root;
      void this.releaseSubscription();
    });
  }

  /**
   * Subscribes to the connector's events.
   *
   * The events arrive on the same channel as the answers, so one
   * listener serves both. Without this call the store would never
   * hear a change, however well the subscription worked.
   */
  connect(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.bridge.subscribe((event) => this.update(event));
  }

  disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Ends the subscription the backend keeps, if there is one.
   *
   * A watch that nobody cancelled is a watch that never stops: the
   * backend keeps the files open and keeps pushing changes about a
   * project the user already left.
   */
  private async releaseSubscription(): Promise<void> {
    const subscriptionId = this.subscriptionId();
    this.subscriptionId.set(null);
    this.enabled.set(false);
    this.changes.set([]);
    this.sourceFileCount.set(0);
    if (subscriptionId === null) return;
    try {
      await this.bridge.request("cancel", { subscriptionId });
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Turns the watch on or off.
   *
   * `watch` subscribes and `cancel` ends it: they are two separate
   * operations in the Application API, so turning the toggle off is
   * not "watch with enabled: false".
   *
   * A failure leaves the toggle **off** and says why: a checkbox that
   * says it is watching when nothing is watching is worse than a
   * checkbox that stays off.
   */
  async setEnabled(value: boolean, projectRoot: string): Promise<void> {
    this.error.set(null);
    try {
      if (value) {
        const result = await this.bridge.request("watch", { projectRoot });
        this.subscriptionId.set(result.subscription.subscriptionId);
      } else if (this.subscriptionId() !== null) {
        await this.bridge.request("cancel", { subscriptionId: this.subscriptionId() ?? "" });
        this.subscriptionId.set(null);
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
