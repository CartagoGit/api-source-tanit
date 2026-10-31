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
  templateUrl: "./home.component.html",
  styleUrls: ["./home.component.scss"],
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

  /**
   * Opens a project.
   *
   * Opening is a **round trip** now: the backend scans the project
   * and answers with the session and the summary. The screen used to
   * say the project was open the moment it had its name, and every
   * operation behind it failed with `SESSION_NOT_FOUND`.
   */
  async open(path: string): Promise<void> {
    const opened = await this.project.open(path);
    if (opened) this.recents.add(path);
  }
}