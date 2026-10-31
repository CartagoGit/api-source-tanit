import { ChangeDetectionStrategy, Component, inject } from "@angular/core";

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
  template: `
    <section class="history">
      <header><h2>Session history</h2><span>{{ history.entries().length }}</span></header>
      @if (history.error(); as message) { <p role="alert">{{ message }}</p> }
      @for (entry of history.entries(); track entry.capturedAt + entry.kind) {
        <article>
          <strong>{{ entry.kind === "snapshot-ready" ? "Snapshot ready" : "Snapshot stale" }}</strong>
          <span>{{ entry.capturedAt }}</span>
          @if (entry.changedPaths?.length) {
            <small>{{ entry.changedPaths.length }} file(s) changed</small>
          }
        </article>
      } @empty { <p>Nothing has happened in this session yet.</p> }
      <p class="note">The persisted history — past generations with their hashes, comparable and restorable — is not exposed by the API yet.</p>
    </section>
  `,
  styles: `
    .history { display: grid; gap: 12px; }
    header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; } h2 { margin: 0; font-size: 20px; }
    article { display: grid; gap: 3px; padding: 10px 12px; border: 1px solid var(--color-border); background: var(--color-panel); }
    article span, article small, .history p { color: var(--color-muted); }
    .note { font-size: 12px; border-left: 2px solid var(--color-border); padding-left: 10px; }
  `,
})
export class HistoryListComponent {
  readonly history = inject(HistoryStore);
  private readonly project = inject(ProjectStore);

  load(): Promise<void> {
    const root = this.project.projectRoot();
    return root ? this.history.load(root) : Promise.resolve();
  }
}
