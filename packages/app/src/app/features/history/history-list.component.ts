import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { HistoryStore } from "../../core/state/history.store";
import { ProjectStore } from "../../core/state/project.store";

@Component({
  selector: "tanit-history-list",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section><header><h2>History</h2><span>{{ history.entries().length }}</span></header>
      @if (history.error(); as message) { <p role="alert">{{ message }}</p> }
      @for (entry of history.entries(); track entry.id) {
        <button type="button" (click)="history.selectedId.set(entry.id)">
          <strong>{{ entry.timestamp }}</strong><span>{{ entry.count }} operations</span>
          <small>{{ entry.formats.join(", ") }} · {{ entry.sha256 }}</small>
        </button>
        <label>Formats <input [value]="formats" (input)="formats = inputValue($event)" /></label><label>Output <input [value]="outputDirectory" (input)="outputDirectory = inputValue($event)" /></label><button type="button" (click)="reExport(entry.id)">Re-export</button>
        <button type="button" (click)="restore(entry.id)">Restore</button>
      } @empty { <p>No snapshots recorded.</p> }
      @if (history.lastRestore(); as restored) { <p role="status">Restored {{ restored.historyId }} from {{ restored.provenance.source }}{{ restored.provenance.projectRoot ? " at " + restored.provenance.projectRoot : "" }}.</p>@if (restored.settings; as settings) { <pre>{{ formatSettings(settings) }}</pre> } }
    </section>
  `,
})
export class HistoryListComponent {
  readonly history = inject(HistoryStore);
  private readonly project = inject(ProjectStore);
  formats = "postman";
  outputDirectory = "";

  load(): Promise<void> {
    const root = this.project.projectRoot();
    return root ? this.history.load(root) : Promise.resolve();
  }

  reExport(historyId: string): Promise<void> {
    const root = this.project.projectRoot();
    return root ? this.history.reExport(root, historyId, { formats: this.formats.split(",").map((format) => format.trim()).filter(Boolean), outputDirectory: this.outputDirectory }) : Promise.resolve();
  }

  restore(historyId: string): Promise<void> {
    const root = this.project.projectRoot();
    if (!root || !globalThis.confirm(`Restore snapshot ${historyId}?`)) return Promise.resolve();
    return this.history.restore(root, historyId);
  }

  inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
  formatSettings(settings: unknown): string { return JSON.stringify(settings); }
}