import { Injectable, effect, inject, signal } from "@angular/core";

import { HistoryClient } from "../api/history.client";
import { ProjectStore } from "./project.store";
import type { ISessionEvent } from "../../../../../contracts/interfaces/core/history.interface";

/**
 * What happened to the open session.
 *
 * The app used to expect the **persisted** history here — the
 * generations of past runs, with their hashes, that could be
 * compared, re-exported or restored. The API's `history` handler
 * answers with something else: the session's own events, the
 * snapshot being taken and the files changing under it.
 *
 * Showing the wrong list is worse than showing a shorter one, so
 * the store shows what the backend has, and the section says plainly
 * that the persisted history is not exposed yet.
 */
@Injectable({ providedIn: "root" })
export class HistoryStore {
  private readonly client = inject(HistoryClient);
  private readonly project = inject(ProjectStore);

  readonly entries = signal<ReadonlyArray<ISessionEvent>>([]);
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
  }
}
