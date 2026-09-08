import { ChangeDetectionStrategy, Component, inject, input } from "@angular/core";
import { HistoryClient } from "../../core/api/history.client";
import { ProjectStore } from "../../core/state/project.store";

@Component({
  selector: "tanit-history-diff",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section><header><h2>Snapshot diff</h2><label>Output <input [value]="outputDirectory" (input)="outputDirectory = inputValue($event)" /></label><button type="button" (click)="compare()">Compare</button></header>
      @if (error; as message) { <p role="alert">{{ message }}</p> }
      @if (result; as diff) {
        <p>{{ diff.added.length }} added · {{ diff.removed.length }} removed · {{ diff.changed.length }} changed</p>
        <p>Schemas: {{ diff.schemaChanges.length }} · Auth: {{ diff.authChanges.length }}</p>
        <p>Services: {{ diff.services.length }} · Operations: {{ diff.operations.length }}</p>
        @for (change of diff.serviceChanges; track change.key) { <div>{{ change.key }}: {{ change.before | json }} → {{ change.after | json }}</div> }
        @for (change of diff.operationChanges; track change.key) { <div>{{ change.key }}: {{ change.before | json }} → {{ change.after | json }}</div> }
      }
    </section>
  `,
})
export class HistoryDiffComponent {
  readonly leftId = input.required<string>();
  readonly rightId = input.required<string>();
  result: Awaited<ReturnType<HistoryClient["compare"]>> | null = null;
  error: string | null = null;
  outputDirectory = "";
  private readonly project = inject(ProjectStore);
  private readonly client = inject(HistoryClient);

  async compare(): Promise<void> {
    const root = this.project.projectRoot();
    if (!root) return;
    this.error = null;
    try { this.result = await this.client.compare(root, this.leftId(), this.rightId(), { outputDirectory: this.outputDirectory }); } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
  }

  inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
}