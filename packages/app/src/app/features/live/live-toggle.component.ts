import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { LiveStore } from "../../core/state/live.store";
import { ProjectStore } from "../../core/state/project.store";
import { I18nService } from "../../core/i18n/i18n.service";

/**
 * The live mode.
 *
 * The toggle asks the backend to watch the open project, and the
 * backend pushes what changes. The section used to carry its own
 * `projectRoot` input, defaulting to `"."` — and the shell never
 * passed one, so the watch would have been asked for the current
 * directory instead of the project the user opened.
 */
@Component({
  selector: "tanit-live-toggle",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./live-toggle.component.html",
})
export class LiveToggleComponent {
  readonly i18n = inject(I18nService);
  readonly store = inject(LiveStore);
  private readonly project = inject(ProjectStore);

  async toggle(event: Event): Promise<void> {
    const root = this.project.projectRoot();
    if (root === null) {
      this.store.error.set(this.i18n.translate("common.openProjectFirstLive"));
      return;
    }
    await this.store.setEnabled(this.checked(event), root);
  }

  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
}