import { ChangeDetectionStrategy, Component, inject, OnDestroy, OnInit } from "@angular/core";

import { ProjectStore } from "../../core/state/project.store";
import { RecentProjectsStore } from "../../core/state/recent-projects.store";
import { DragDropService } from "../../core/host/drag-drop.service";
import { FolderPickerComponent } from "./folder-picker.component";
import { RecentProjectsComponent } from "./recent-projects.component";

@Component({
  selector: "tanit-home",
  standalone: true,
  imports: [FolderPickerComponent, RecentProjectsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="home"><header><span class="eyebrow">Tanit</span><h1>Tus APIs</h1><p>Open a project folder to discover its endpoints.</p></header><tanit-folder-picker (selected)="open($event)" /><tanit-recent-projects (selected)="open($event)" /><details><summary>Advanced</summary><label>Project path<input #path type="text" placeholder="/path/to/project" (keydown.enter)="open(path.value)" /></label></details></div>`,
  styles: `.home { display: grid; gap: var(--space-6); max-width: 800px; } header { display: grid; gap: var(--space-2); } h1 { margin: 0; font-size: clamp(32px, 6vw, 56px); } header p { margin: 0; color: var(--color-muted); } .eyebrow { color: var(--color-copper); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; } details { border-top: 1px solid var(--color-border); padding-top: var(--space-3); } label { display: grid; gap: var(--space-2); margin-top: var(--space-3); color: var(--color-muted); } input { max-width: 520px; padding: var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-panel); color: var(--color-ink); }`,
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly project = inject(ProjectStore);
  private readonly recents = inject(RecentProjectsStore);
  private readonly dragDrop = inject(DragDropService);
  private unsubscribeDrop?: () => void;

  ngOnInit(): void {
    this.recents.load();
    void this.dragDrop.connect();
    this.unsubscribeDrop = this.dragDrop.onDrop(({ path }) => this.open(path));
  }

  ngOnDestroy(): void { this.unsubscribeDrop?.(); this.dragDrop.disconnect(); }

  open(path: string): void { this.project.open(path); this.recents.add(path); }
}