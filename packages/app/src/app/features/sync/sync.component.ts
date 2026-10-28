import { ChangeDetectionStrategy, Component, inject, input, signal } from "@angular/core";
import { HostBridgeClient } from "../../core/api/host-bridge.client";

@Component({
  selector: "tanit-sync",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-labelledby="sync-title"><h2 id="sync-title">Sync</h2><button type="button" [disabled]="running()" (click)="run(false)">{{ running() ? "Syncing…" : "Sync project" }}</button><button type="button" [disabled]="running()" (click)="run(true)">Dry run</button>@if (message(); as value) { <p role="status">{{ value }}</p> }</section>`,
})
export class SyncComponent {
  readonly projectRoot = input(".");
  readonly running = signal(false);
  readonly message = signal<string | null>(null);
  private readonly bridge = inject(HostBridgeClient);

  async run(dryRun: boolean): Promise<void> {
    this.running.set(true);
    try {
      const result = await this.bridge.request("sync", { projectRoot: this.projectRoot() });
      this.message.set(dryRun ? "Sync preview ready." : result.synced ? "Project synced." : "Sync did not complete.");
    } finally {
      this.running.set(false);
    }
  }
}