import { ChangeDetectionStrategy, Component, inject, OnDestroy, OnInit, output } from "@angular/core";

import { ProjectStore } from "../../core/state/project.store";
import { RecentProjectsStore } from "../../core/state/recent-projects.store";
import { DragDropService } from "../../core/host/drag-drop.service";
import { FolderPickerComponent } from "./folder-picker.component";
import { RecentProjectsComponent } from "./recent-projects.component";
import { I18nService } from "../../core/i18n/i18n.service";

@Component({
  selector: "tanit-home",
  standalone: true,
  imports: [FolderPickerComponent, RecentProjectsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./home.component.html",
  styleUrls: ["./home.component.scss"],
})
export class HomeComponent implements OnInit, OnDestroy {
  readonly i18n = inject(I18nService);
  readonly project = inject(ProjectStore);
  readonly recents = inject(RecentProjectsStore);
  private readonly dragDrop = inject(DragDropService);
  readonly opened = output<void>();
  private unsubscribeDrop?: () => void;

  ngOnInit(): void {
    this.recents.load();
    void this.dragDrop.connect();
    this.unsubscribeDrop = this.dragDrop.onDrop(({ path }) => this.open(path));
  }

  ngOnDestroy(): void { this.unsubscribeDrop?.(); this.dragDrop.disconnect(); }

  async open(path: string): Promise<void> {
    if (await this.project.open(path)) {
      this.recents.add(this.project.projectRoot() ?? path);
      this.opened.emit();
    }
  }
}
