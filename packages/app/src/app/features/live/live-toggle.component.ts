import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { LiveStore } from "../../core/state/live.store";
import { ProjectStore } from "../../core/state/project.store";

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
  template: `<section aria-labelledby="live-title"><h2 id="live-title">Live mode</h2><label><input type="checkbox" [checked]="store.enabled()" (change)="toggle($event)" /> Watch source files</label><label><input type="checkbox" [checked]="store.autoExport()" (change)="store.setAutoExport(checked($event))" /> Auto-export</label><p>Watching {{ store.sourceFileCount() }} source files</p>@if (store.error(); as message) { <p role="alert">{{ message }}</p> }@for (change of store.changes(); track change.path + change.kind) { <p>{{ change.kind }}: {{ change.path }}</p> }</section>`,
})
export class LiveToggleComponent {
  readonly store = inject(LiveStore);
  private readonly project = inject(ProjectStore);

  async toggle(event: Event): Promise<void> {
    const root = this.project.projectRoot();
    if (root === null) {
      this.store.error.set("Open a project first: there is nothing to watch yet.");
      return;
    }
    await this.store.setEnabled(this.checked(event), root);
  }

  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
}