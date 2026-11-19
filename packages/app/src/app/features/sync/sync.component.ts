import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { SyncClient } from "../../core/api/sync.client";
import { ProjectStore } from "../../core/state/project.store";
import type { SyncOutput } from "../../../../../contracts/interfaces/core/application-api.interface";
import { I18nService } from "../../core/i18n/i18n.service";

/**
 * The sync.
 *
 * ## What it used to be
 *
 * A button that called an operation with no handler and told the
 * user, every time, that the action was CLI-only. The composed verb
 * — `dry-run` plus `export` — lived in the CLI and the app could
 * not reach it.
 *
 * ## What it is
 *
 * The composition moved to the core and the Application API exposes
 * it. The screen asks, and draws **the answer**: the files that were
 * written, or the files that would be written.
 *
 * It used to carry its own `projectRoot` input, defaulting to `"."`
 * — and the shell never passed one, so the sync would have been
 * asked for the current directory instead of the open project.
 */
@Component({
  selector: "tanit-sync",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./sync.component.html",
  styleUrls: ["./sync.component.scss"],
})
export class SyncComponent {
  readonly i18n = inject(I18nService);
  readonly running = signal(false);
  readonly message = signal<string | null>(null);
  readonly result = signal<SyncOutput | null>(null);
  private readonly project = inject(ProjectStore);
  private readonly client = inject(SyncClient);

  async run(dryRun: boolean): Promise<void> {
    const root = this.project.projectRoot();
    if (root === null) {
      this.message.set(this.i18n.translate("common.openProjectFirst"));
      return;
    }
    this.running.set(true);
    this.message.set(null);
    this.result.set(null);
    try {
      const result = await this.client.sync(root, { dryRun });
      this.result.set(result);
      this.message.set(
        dryRun
          ? `${result.plannedFiles.length} file(s) would be written, ${result.endpointCount} endpoint(s).`
          : `${result.files.length} file(s) written, ${result.endpointCount} endpoint(s).`,
      );
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.running.set(false);
    }
  }
}