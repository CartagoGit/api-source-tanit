import { ChangeDetectionStrategy, Component, inject, output, signal } from "@angular/core";

import type { IBrowseListing } from "../../../../../contracts/interfaces/core/browse.interface";
import { RecentProjectsClient } from "../../core/api/recent-projects.client";
import { DialogService } from "../../core/host/dialog.service";
import { ButtonComponent } from "../../shared/button/button.component";

@Component({
  selector: "tanit-folder-picker",
  standalone: true,
  imports: [ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./folder-picker.component.html",
  styleUrls: ["./folder-picker.component.scss"],
})
export class FolderPickerComponent {
  readonly selected = output<string>();
  readonly dialog = inject(DialogService);
  readonly client = inject(RecentProjectsClient);
  readonly listing = signal<IBrowseListing | null>(null);
  readonly hovering = signal(false);
  readonly error = signal<string | null>(null);

  async openNative(): Promise<void> {
    this.error.set(null);
    const path = await this.dialog.pickFolder();
    if (path) this.selected.emit(path);
  }

  async browseRoot(): Promise<void> { await this.open(); }

  async open(path?: string | null): Promise<void> {
    this.error.set(null);
    try { this.listing.set(await this.client.browse(path ?? undefined)); } catch (error) { this.error.set((error as Error).message); }
  }

  onBrowserDrop(event: DragEvent): void {
    event.preventDefault();
    this.hovering.set(false);
    const path = event.dataTransfer?.getData("text/plain").trim();
    if (path) this.selected.emit(path);
  }
}