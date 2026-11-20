import { Injectable, effect, inject, signal } from "@angular/core";
import { HostBridgeClient } from "../api/host-bridge.client";
import { ProjectStore } from "./project.store";
import { ExportsStore } from "./exports.store";
import { isLiveEvent, isLiveOutputChange } from "../../../../../core/helpers/live-event.helper";
import type { LiveChange } from "../../../../../contracts/interfaces/core/live.interface";

export type { LiveChange } from "../../../../../contracts/interfaces/core/live.interface";

/** Live state consumes the same session events over either host carrier. */
@Injectable({ providedIn: "root" })
export class LiveStore {
  readonly enabled = signal(false);
  readonly autoExport = signal(false);
  readonly sourceFileCount = signal(0);
  readonly changes = signal<ReadonlyArray<LiveChange>>([]);
  readonly error = signal<string | null>(null);
  readonly subscriptionId = signal<string | null>(null);

  private readonly bridge = inject(HostBridgeClient);
  private readonly project = inject(ProjectStore);
  private readonly exports = inject(ExportsStore);
  private unsubscribe: (() => void) | null = null;
  private generation = 0;
  private exporting = false;
  private exportPending = false;

  constructor() {
    this.connect();
    let previous = this.project.projectRoot();
    effect(() => {
      const root = this.project.projectRoot();
      if (root === previous) return;
      previous = root;
      void this.releaseSubscription();
    });
  }

  connect(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.bridge.subscribe((event) => this.update(event));
  }

  disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    void this.releaseSubscription();
  }

  ngOnDestroy(): void { this.disconnect(); }

  private async releaseSubscription(): Promise<void> {
    this.generation++;
    const subscriptionId = this.subscriptionId();
    this.subscriptionId.set(null);
    this.enabled.set(false);
    this.changes.set([]);
    this.sourceFileCount.set(0);
    this.exportPending = false;
    if (subscriptionId === null) return;
    try { await this.bridge.request("cancel", { subscriptionId }); }
    catch (error) { this.error.set(describe(error)); }
  }

  /** Race-safe enable/cancel: an obsolete response cannot reactivate a watch. */
  async setEnabled(value: boolean, projectRoot: string): Promise<void> {
    this.error.set(null);
    if (!value) { await this.releaseSubscription(); return; }
    if (this.enabled() && this.subscriptionId() !== null) return;
    const generation = ++this.generation;
    this.enabled.set(true);
    try {
      const result = await this.bridge.request("watch", { projectRoot });
      const id = result.subscription.subscriptionId;
      if (generation !== this.generation || projectRoot !== this.project.projectRoot()) {
        await this.bridge.request("cancel", { subscriptionId: id });
        return;
      }
      this.subscriptionId.set(id);
    } catch (error) {
      if (generation !== this.generation) return;
      this.enabled.set(false);
      this.error.set(describe(error));
    }
  }

  setAutoExport(value: boolean): void { this.autoExport.set(value); }

  update(frame: unknown): void {
    if (typeof frame !== "object" || frame === null || !("method" in frame) || !("params" in frame)) return;
    if (frame.method === "tanit/connection-error") {
      const params = frame.params;
      if (typeof params === "object" && params !== null && "subscriptionId" in params &&
          params.subscriptionId === this.subscriptionId() && "message" in params && typeof params.message === "string") {
        this.error.set(params.message);
        void this.releaseSubscription();
      }
      return;
    }
    if (frame.method !== "tanit/live" || !isLiveEvent(frame.params)) return;
    const event = frame.params;
    if (!this.enabled() || event.projectRoot !== this.project.projectRoot() ||
        event.sessionId !== this.project.sessionId() ||
        (this.subscriptionId() !== null && event.subscriptionId !== this.subscriptionId())) return;
    if (event.type === "snapshot-ready") {
      this.error.set(null);
      this.sourceFileCount.set(event.sourceFileCount);
      this.project.applySummary(event.summary);
      const outputs = this.exports.result()?.files.map((file) => file.path) ?? [];
      if (this.autoExport() && event.changedPaths.some((path) =>
        !isLiveOutputChange(path, event.projectRoot, outputs))) void this.regenerate();
    } else if (event.type === "snapshot-error") {
      this.error.set(event.message);
    } else if (event.type === "snapshot-stale") {
      this.changes.set(event.changedPaths.map((path) => ({ kind: "modified", path })));
    } else {
      this.generation++;
      this.subscriptionId.set(null);
      this.enabled.set(false);
      this.exportPending = false;
    }
  }

  private async regenerate(): Promise<void> {
    this.exportPending = true;
    if (this.exporting) return;
    this.exporting = true;
    try {
      while (this.exportPending && this.autoExport() && this.enabled()) {
        this.exportPending = false;
        await this.exports.regenerate();
        if (this.exports.error() !== null) this.error.set(this.exports.error());
      }
    } catch (error) { this.error.set(describe(error)); }
    finally { this.exporting = false; }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
