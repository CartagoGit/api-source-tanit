import { ChangeDetectionStrategy, Component, effect, inject, input } from "@angular/core";
import { JsonPipe } from "@angular/common";
import { HistoryClient } from "../../core/api/history.client";
import { ProjectStore } from "../../core/state/project.store";
import { I18nService } from "../../core/i18n/i18n.service";
import type { HistoryDiffOutput } from "../../../../../contracts/interfaces/core/application-api.interface";

/**
 * What changed between two revisions.
 *
 * The diff comes from the two **records**: each one carries the
 * configuration it was made with, so the comparison knows how they
 * were built and not only what they hold.
 */
@Component({
  selector: "tanit-history-diff",
  standalone: true,
  imports: [JsonPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./history-diff.component.html",
  styleUrls: ["./history-diff.component.scss"],
})
export class HistoryDiffComponent {
  readonly i18n = inject(I18nService);
  readonly leftId = input.required<string>();
  readonly rightId = input.required<string>();
  result: HistoryDiffOutput | null = null;
  error: string | null = null;
  outputDirectory = "";
  private readonly project = inject(ProjectStore);
  private readonly client = inject(HistoryClient);

  constructor() {
    // The comparison follows the two revisions: picking them is the
    // request, and a screen that needs a second click to answer the
    // question it just asked is a screen that answers late.
    effect(() => {
      const left = this.leftId();
      const right = this.rightId();
      if (left !== "" && right !== "") void this.compare();
    });
  }

  async compare(): Promise<void> {
    const root = this.project.projectRoot();
    if (!root) return;
    this.error = null;
    try {
      this.result = await this.client.compare(root, this.leftId(), this.rightId());
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  async loadConfiguration(): Promise<void> {
    const root = this.project.projectRoot();
    if (!root) return;
    try {
      const configuration = await this.client.compareConfig(root, this.leftId(), this.rightId());
      const after = configuration.after;
      this.outputDirectory = after && typeof after === "object" && "outputDirectory" in after ? String(after.outputDirectory ?? "") : "";
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
  }

  inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
}