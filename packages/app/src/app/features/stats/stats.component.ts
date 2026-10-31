import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";

import { StatsClient } from "../../core/api/stats.client";
import { ProjectStore } from "../../core/state/project.store";
import type { IStatsResult } from "../../../../../contracts/interfaces/core/application-api.interface";

/**
 * The collection statistics.
 *
 * ## What it used to be
 *
 * Nothing: the counting lived in the CLI, so the app could not ask
 * for it. The counts the CLI prints — per method, per zone — had no
 * counterpart in the app.
 *
 * ## What it is
 *
 * The counting moved to the core and the Application API exposes it.
 * The numbers the screen shows are the numbers the CLI prints,
 * because there is only one function that counts.
 */
@Component({
  selector: "tanit-stats",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./stats.component.html",
  styleUrls: ["./stats.component.scss"],
})
export class StatsComponent {
  readonly running = signal(false);
  readonly message = signal<string | null>(null);
  readonly stats = signal<IStatsResult | null>(null);
  private readonly project = inject(ProjectStore);
  private readonly client = inject(StatsClient);

  async run(): Promise<void> {
    const root = this.project.projectRoot();
    if (root === null) {
      this.message.set("Open a project first.");
      return;
    }
    this.running.set(true);
    this.message.set(null);
    this.stats.set(null);
    try {
      const stats = await this.client.stats(root);
      this.stats.set(stats);
      this.message.set(`${stats.total} requests in ${stats.byMethod.length} method(s).`);
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.running.set(false);
    }
  }
}
