import { ChangeDetectionStrategy, Component, inject, output } from "@angular/core";

import { RecentProjectsStore } from "../../core/state/recent-projects.store";

@Component({
  selector: "tanit-recent-projects",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="recents" aria-labelledby="recent-projects-title">
      <div class="heading"><h2 id="recent-projects-title">Recent projects</h2><button type="button" [disabled]="!store.projects().length" (click)="store.clear()">Forget all</button></div>
      @if (!store.projects().length) { <p>No recent projects yet.</p> } @else { @for (project of store.projects(); track project.path) { <div class="recent"><button type="button" class="open" (click)="selected.emit(project.path)"><strong>{{ projectName(project.path) }}</strong><small>{{ project.path }}</small></button><button type="button" class="forget" [attr.aria-label]="'Forget ' + project.path" (click)="store.remove(project.path)">Forget</button></div> } }
    </section>
  `,
  styles: `
    .recents { display: grid; gap: var(--space-3); } .heading { display: flex; justify-content: space-between; align-items: center; } h2 { margin: 0; font-size: 18px; } p, small { color: var(--color-muted); }
    button { font: inherit; } .heading button, .forget { border: 0; background: transparent; color: var(--color-muted); cursor: pointer; } .recent { display: flex; gap: var(--space-2); align-items: center; border-top: 1px solid var(--color-border); padding-top: var(--space-2); }
    .open { display: grid; flex: 1; gap: 2px; min-width: 0; border: 0; background: transparent; color: var(--color-ink); text-align: left; cursor: pointer; } small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `,
})
export class RecentProjectsComponent {
  readonly selected = output<string>();
  readonly store = inject(RecentProjectsStore);

  projectName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  }
}