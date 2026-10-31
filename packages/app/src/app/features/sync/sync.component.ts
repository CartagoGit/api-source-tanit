import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { HostBridgeClient } from "../../core/api/host-bridge.client";
import { describePending } from "../../core/api/pending-operation.helper";
import { ProjectStore } from "../../core/state/project.store";

/**
 * The sync.
 *
 * The composed verb has no handler yet: the pipeline is `dry-run`
 * plus `export`, both of which exist, and the app reaches them from
 * the Export Center. This section asks for it anyway, as a pending
 * operation, so the gap is written down.
 *
 * It used to carry its own `projectRoot` input, defaulting to `"."`
 * — and the shell never passed one, so the sync would have been
 * asked for the current directory instead of the open project.
 */
@Component({
  selector: "tanit-sync",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-labelledby="sync-title"><h2 id="sync-title">Sync</h2><button type="button" [disabled]="running()" (click)="run(false)">{{ running() ? "Syncing…" : "Sync project" }}</button><button type="button" [disabled]="running()" (click)="run(true)">Dry run</button>@if (message(); as value) { <p role="status">{{ value }}</p> }</section>`,
})
export class SyncComponent {
  readonly running = signal(false);
  readonly message = signal<string | null>(null);
  private readonly project = inject(ProjectStore);
  private readonly bridge = inject(HostBridgeClient);

  async run(dryRun: boolean): Promise<void> {
    const root = this.project.projectRoot();
    if (root === null) {
      this.message.set("Open a project first.");
      return;
    }
    this.running.set(true);
    this.message.set(null);
    try {
      // `sync` has no handler yet: the pipeline is `dry-run` + `export`,
      // both of which exist, but the composed verb does not.
      const result = await this.bridge.requestPending("sync", { projectRoot: root }) as { synced?: boolean };
      this.message.set(dryRun ? "Sync preview ready." : result.synced ? "Project synced." : "Sync did not complete.");
    } catch (error) {
      this.message.set(describePending("sync", error));
    } finally {
      this.running.set(false);
    }
  }
}