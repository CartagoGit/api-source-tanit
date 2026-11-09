import { Injectable, effect, inject, signal } from "@angular/core";

import { HistoryClient } from "../api/history.client";
import { ProjectStore } from "./project.store";
import type { ISessionEvent, IHistorySummary } from "../../../../../contracts/interfaces/core/history.interface";

/**
 * The history of the open project.
 *
 * Two lists, because they are two things:
 *
 *   · the **events** — the snapshot was taken, the files under it
 *     changed. They are what happens while the project is open;
 *   · the **revisions** — the past generations, with their hashes,
 *     that can be compared, exported again or restored. They are on
 *     disk, so a revision outlives the session that made it.
 *
 * The store used to show only the events and to say in a note that
 * the persisted history was not exposed. It is: the handlers landed,
 * and the history is in `~/.tanit/history/`.
 */
@Injectable({ providedIn: "root" })
export class HistoryStore {
  private readonly client = inject(HistoryClient);
  private readonly project = inject(ProjectStore);

  readonly entries = signal<ReadonlyArray<ISessionEvent>>([]);
  readonly revisions = signal<ReadonlyArray<IHistorySummary>>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    // The events belong to **a** session. When the project changes,
    // the previous session's events are not this project's history.
    let previous: string | null | undefined;
    effect(() => {
      const root = this.project.projectRoot();
      if (root === previous) return;
      previous = root;
      this.entries.set([]);
      this.revisions.set([]);
      this.error.set(null);
    });
  }

  async load(projectRoot: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.entries.set(await this.client.list(projectRoot));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.loading.set(false);
    }
    try {
      const answer = await this.client.revisions(projectRoot);
      this.revisions.set(answer.entries);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }
}
