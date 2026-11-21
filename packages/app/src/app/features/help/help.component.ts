import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";

import { I18nService } from "../../core/i18n/i18n.service";

const REPOSITORY = "https://github.com/CartagoGit/api-source-tanit";

@Component({
  selector: "tanit-help",
  standalone: true,
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
  readonly repository = REPOSITORY;
  readonly issues = `${REPOSITORY}/issues`;
  readonly reportIssue = `${this.issues}/new/choose`;

  async openLink(event: MouseEvent, url: string): Promise<void> {
    const tauri = (globalThis as {
      __TAURI__?: { core?: { invoke(command: string, args: { path: string }): Promise<unknown> } };
    }).__TAURI__;
    if (!tauri?.core) return;

    event.preventDefault();
    this.linkFailed.set(false);
    try {
      await tauri.core.invoke("plugin:shell|open", { path: url });
    } catch {
      this.linkFailed.set(true);
    }
  }
}
