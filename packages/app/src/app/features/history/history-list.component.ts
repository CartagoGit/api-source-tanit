import { ChangeDetectionStrategy, Component, effect, inject, signal } from "@angular/core";

import { HistoryStore } from "../../core/state/history.store";
import { ProjectStore } from "../../core/state/project.store";
import { I18nService } from "../../core/i18n/i18n.service";
import { HistoryDiffComponent } from "./history-diff.component";
import type { IHistorySummary } from "../../../../../contracts/interfaces/core/history.interface";

/**
 * The history of the project.
 *
 * Two things, and the screen says which is which:
 *
 *   · the **events** of the open session — the snapshot was taken, the
 *     files under it changed;
 *   · the **revisions** — the past generations, with their hashes.
 *     Two of them can be compared, one can be exported again and one
 *     can be restored.
 *
 * The revisions used to be a note saying they were not exposed. They
 * are: the history is on disk (`~/.tanit/history/`) and the handlers
 * are behind the bridge.
 */
@Component({
  selector: "tanit-history-list",
  standalone: true,
  imports: [HistoryDiffComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./history-list.component.html",
  styleUrls: ["./history-list.component.scss"],
})
export class HistoryListComponent {
  readonly i18n = inject(I18nService);
  readonly history = inject(HistoryStore);
  /** The revision on the left of the comparison. */
  readonly left = signal<string>("");
  /** The revision on the right of the comparison. */
  readonly right = signal<string>("");
  private readonly project = inject(ProjectStore);

  constructor() {
    // The session's events are asked for when the project opens. The
    // section had a `load()` that nobody called, so it said "nothing
    // has happened yet" about a session that had just happened.
    effect(() => {
      if (this.project.projectRoot() !== null) void this.load();
    });
  }

  load(): Promise<void> {
    const root = this.project.projectRoot();
    return root ? this.history.load(root) : Promise.resolve();
  }

  /** The two revisions to compare, when there are two. */
  canCompare(): boolean {
    return this.left() !== "" && this.right() !== "" && this.left() !== this.right();
  }

  /** The label of a revision: when it was made, and what it held. */
  label(revision: IHistorySummary): string {
    return `${revision.timestamp} · ${revision.count} ${this.i18n.translate("history.operations")}`;
  }

  /** The revision chosen in a select. */
  selected(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }
}
