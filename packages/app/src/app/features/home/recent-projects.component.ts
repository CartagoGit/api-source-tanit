import { ChangeDetectionStrategy, Component, inject, output } from "@angular/core";

import { RecentProjectsStore } from "../../core/state/recent-projects.store";
import { I18nService } from "../../core/i18n/i18n.service";

@Component({
  selector: "tanit-recent-projects",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./recent-projects.component.html",
  styleUrls: ["./recent-projects.component.scss"],
})
export class RecentProjectsComponent {
  readonly i18n = inject(I18nService);
  readonly selected = output<string>();
  readonly store = inject(RecentProjectsStore);

  projectName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  }
}