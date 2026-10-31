import { ChangeDetectionStrategy, Component, inject, input, signal } from "@angular/core";
import { HostBridgeClient } from "../../core/api/host-bridge.client";
import { describePending } from "../../core/api/pending-operation.helper";

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
      // `sync` has no handler yet: the pipeline is `dry-run` + `export`,
      // both of which exist, but the composed verb does not.
      const result = await this.bridge.requestPending("sync", { projectRoot: this.projectRoot() }) as { synced?: boolean };
      this.message.set(dryRun ? "Sync preview ready." : result.synced ? "Project synced." : "Sync did not complete.");
    } catch (error) {
      this.message.set(describePending("sync", error));
    } finally {
      this.running.set(false);
    }
  }
}