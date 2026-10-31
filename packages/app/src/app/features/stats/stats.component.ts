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
  template: `<section aria-labelledby="stats-title"><h2 id="stats-title">Statistics</h2><button type="button" [disabled]="running()" (click)="run()">{{ running() ? "Measuring…" : "Measure collection" }}</button>@if (message(); as value) { <p role="status">{{ value }}</p> }@if (stats(); as answer) { <p class="total">{{ answer.total }} requests</p><h3>By method</h3><ul>@for (entry of answer.byMethod; track entry.method) { <li><span>{{ entry.method }}</span><span>{{ entry.count }}</span></li> }</ul>@for (zone of answer.zones; track zone.zone) { <h3>{{ zone.zone }} ({{ zone.total }})</h3><ul>@for (entry of zone.byFolder; track entry.folder) { <li><span>{{ entry.folder }}</span><span>{{ entry.count }}</span></li> }</ul> } }</section>`,
  styles: `.total { font-size: 28px; font-variant-numeric: tabular-nums; } h3 { margin-top: var(--space-4); font-size: 14px; } ul { list-style: none; padding: 0; display: grid; gap: var(--space-1); max-width: 420px; } li { display: flex; justify-content: space-between; gap: var(--space-4); border-bottom: 1px solid var(--color-border); padding: var(--space-1) 0; }`,
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
