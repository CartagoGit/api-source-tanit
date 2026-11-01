import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";

import { ProjectStore } from "../../core/state/project.store";
import { I18nService } from "../../core/i18n/i18n.service";

/**
 * What the scan noticed about the project.
 *
 * ## What this section used to be
 *
 * A navigation entry with **nothing behind it**. "Diagnostics" was in
 * the sidebar, the shell had no case for it, and it fell through to
 * the generic empty state — a blank page with the word "Diagnostics"
 * on it.
 *
 * ## What it is
 *
 * The scan's own warnings ("no endpoints were found", "this folder
 * is not a route file") and the detectors that crashed reading a
 * file. The backend already knew all of it — the snapshot carries
 * them — and the app threw them away.
 *
 * Now the summary carries them and this section draws them.
 */
@Component({
  selector: "tanit-diagnostics",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./diagnostics.component.html",
  styleUrls: ["./diagnostics.component.scss"],
})
export class DiagnosticsComponent {
  readonly i18n = inject(I18nService);
  private readonly project = inject(ProjectStore);

  /**
   * The diagnostics of the open project.
   *
   * The list is empty when there is no project — not an error: there
   * is nothing to report about a project that is not open.
   */
  readonly diagnostics = computed(() => this.project.summary()?.diagnostics ?? []);
}
