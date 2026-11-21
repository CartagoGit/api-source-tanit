import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";

import { I18nService } from "../../core/i18n/i18n.service";

import { ExternalLinkService } from "../../core/host/external-link.service";
import { APP_METADATA } from "../../core/app-metadata";
import { GitHubMarkComponent } from "../../shared/github-mark.component";

@Component({
  selector: "tanit-help",
  standalone: true,
  imports: [GitHubMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./help.component.html",
  styleUrls: ["./help.component.scss"],
})
export class HelpComponent {
  readonly i18n = inject(I18nService);
  readonly linkFailed = signal(false);
  readonly shortcuts = [
    { keys: ["Ctrl / ⌘", "K"], labelKey: "help.openPalette" },
    { keys: ["↑", "↓"], labelKey: "help.navigate" },
    { keys: ["Enter"], labelKey: "help.choose" },
    { keys: ["Esc"], labelKey: "help.close" },
    { keys: ["Tab"], labelKey: "help.focus" },
  ];
  private readonly externalLinks = inject(ExternalLinkService);
  readonly repository = APP_METADATA.repository;
  readonly issues = `${this.repository}/issues`;
  readonly reportIssue = `${this.issues}/new/choose`;

  async openLink(event: MouseEvent, url: string): Promise<void> {
    this.linkFailed.set(false);
    this.linkFailed.set(!(await this.externalLinks.open(event, url)));
  }
}
