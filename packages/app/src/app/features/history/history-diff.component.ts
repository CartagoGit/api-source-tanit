import { ChangeDetectionStrategy, Component, inject, input } from "@angular/core";
import { JsonPipe } from "@angular/common";
import { HistoryClient } from "../../core/api/history.client";
import { ProjectStore } from "../../core/state/project.store";

@Component({
  selector: "tanit-history-diff",
  standalone: true,
  imports: [JsonPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./history-diff.component.html",
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

  async loadConfiguration(): Promise<void> {
    const root = this.project.projectRoot();
    if (!root) return;
    try {
      const configuration = (await this.client.compareConfig(root, this.leftId(), this.rightId())) as {
        after?: unknown;
      } | null;
      const after = configuration?.after;
      this.outputDirectory = after && typeof after === "object" && "outputDirectory" in after ? String(after.outputDirectory ?? "") : "";
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
  }

  inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
}