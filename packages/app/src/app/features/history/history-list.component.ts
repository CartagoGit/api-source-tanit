import { ChangeDetectionStrategy, Component, effect, inject } from "@angular/core";

import { HistoryStore } from "../../core/state/history.store";
import { ProjectStore } from "../../core/state/project.store";

/**
 * What happened to the open session.
 *
 * It shows the session's events: the snapshot was taken, or the
 * files it was built from changed.
 *
 * The **persisted** history — past generations, with their hashes,
 * that can be compared, re-exported or restored — is not here: no
 * handler exposes it yet, and the section says so instead of showing
 * an empty table of columns that would never be filled.
 */
@Component({
  selector: "tanit-history-list",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./history-list.component.html",
  styleUrls: ["./history-list.component.scss"],
})
export class HistoryListComponent {
  readonly history = inject(HistoryStore);
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
}
