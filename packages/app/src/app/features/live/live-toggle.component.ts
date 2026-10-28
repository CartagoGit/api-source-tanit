import { ChangeDetectionStrategy, Component, inject, input } from "@angular/core";
import { LiveStore } from "../../core/state/live.store";

@Component({
  selector: "tanit-live-toggle",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-labelledby="live-title"><h2 id="live-title">Live mode</h2><label><input type="checkbox" [checked]="store.enabled()" (change)="toggle($event)" /> Watch source files</label><label><input type="checkbox" [checked]="store.autoExport()" (change)="store.setAutoExport(checked($event))" /> Auto-export</label><p>Watching {{ store.sourceFileCount() }} source files</p>@for (change of store.changes(); track change.path + change.kind) { <p>{{ change.kind }}: {{ change.path }}</p> }</section>`,
})
export class LiveToggleComponent {
  readonly projectRoot = input(".");
  readonly store = inject(LiveStore);
  async toggle(event: Event): Promise<void> { await this.store.setEnabled(this.checked(event), this.projectRoot()); }
  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
}