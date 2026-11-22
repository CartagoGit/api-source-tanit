import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from "@angular/core";

import type { IBrowseListing } from "../../../../../contracts/interfaces/core/browse.interface";
import { RecentProjectsClient } from "../../core/api/recent-projects.client";
import { DialogService } from "../../core/host/dialog.service";
import { I18nService } from "../../core/i18n/i18n.service";

@Component({
  selector: "tanit-folder-picker",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./folder-picker.component.html",
  styleUrls: ["./folder-picker.component.scss"],
})
export class FolderPickerComponent {
  readonly i18n = inject(I18nService);
  readonly busy = input(false);
  readonly purpose = input<"project" | "export">("project");
  readonly initialPath = input<string | null>(null);
  readonly selected = output<string>();
  private readonly dialog = inject(DialogService);
  private readonly client = inject(RecentProjectsClient);
  readonly canPickNatively = this.dialog.canPickFolder();
  readonly listing = signal<IBrowseListing | null>(null);
  readonly expanded = signal(false);
  readonly browsing = signal(false);
  readonly typedPath = signal("");
  readonly error = signal<string | null>(null);
  private readonly retryPath = signal<string | null | undefined>(undefined);
  readonly canRetry = computed(() => this.retryPath() !== undefined);

  async openNative(): Promise<void> {
    this.error.set(null);
    try {
      const path = await this.dialog.pickFolder();
      if (path) this.selected.emit(path);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  async toggleBrowse(): Promise<void> {
    const expanded = !this.expanded();
    this.expanded.set(expanded);
    if (!expanded) this.error.set(null);
    if (expanded && this.listing() === null) {
      const path = this.retryPath();
      await this.open(path === undefined ? this.initialPath() : path);
    }
  }

  async retryBrowse(): Promise<void> {
    const path = this.retryPath();
    if (path !== undefined) await this.open(path);
  }

  async open(path?: string | null): Promise<void> {
    if (this.browsing()) return;
    this.error.set(null);
    this.browsing.set(true);
    try {
      this.listing.set(await this.client.browse(path ?? undefined));
      this.retryPath.set(undefined);
    } catch (error) {
      this.retryPath.set(path ?? null);
      this.listing.set(null);
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.browsing.set(false);
    }
  }

  submitPath(event: Event): void {
    event.preventDefault();
    const path = this.typedPath().trim();
    if (path && !this.busy()) this.selected.emit(path);
  }

  useCurrent(): void {
    const listing = this.listing();
    if (listing?.ok && !this.browsing() && !this.busy()) this.selected.emit(listing.path);
  }
}
