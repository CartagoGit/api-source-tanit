import { ChangeDetectionStrategy, Component, inject, output, signal } from "@angular/core";

import type { IBrowseListing } from "../../../../../contracts/interfaces/cli/browse.interface";
import { RecentProjectsClient } from "../../core/api/recent-projects.client";
import { DialogService } from "../../core/host/dialog.service";
import { ButtonComponent } from "../../shared/button/button.component";

@Component({
  selector: "tanit-folder-picker",
  standalone: true,
  imports: [ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="picker" aria-labelledby="folder-picker-title">
      <div class="picker-heading"><div><h2 id="folder-picker-title">Open a project</h2><p>Choose the folder that contains your API source.</p></div><tanit-button primary (click)="openNative()">Open folder</tanit-button></div>
      <div class="drop-zone" [class.hovering]="hovering()" role="button" tabindex="0" (click)="browseRoot()" (keydown.enter)="browseRoot()" (dragenter)="hovering.set(true)" (dragleave)="hovering.set(false)" (drop)="onBrowserDrop($event)">
        <strong>Drop a project folder here</strong><span>or browse folders</span>
      </div>
      @if (listing(); as current) {
        <div class="browse" aria-live="polite">
          <div class="breadcrumbs"><button type="button" [disabled]="!current.parent" (click)="open(current.parent)">Up</button><span>{{ current.path }}</span></div>
          @for (entry of current.entries; track entry.path) { <button class="entry" type="button" [disabled]="!entry.readable" (click)="open(entry.path)"><span>{{ entry.name }}</span><small>Folder</small></button> }
          @if (current.truncated) { <p class="notice">{{ current.reason }}</p> }
        </div>
      }
      @if (error(); as message) { <p class="error" role="alert">{{ message }}</p> }
    </section>
  `,
  styles: `
    .picker { display: grid; gap: var(--space-4); max-width: 760px; }
    .picker-heading { display: flex; justify-content: space-between; gap: var(--space-4); align-items: start; }
    h2 { margin: 0; font-size: 24px; } p { color: var(--color-muted); margin: var(--space-1) 0 0; }
    .drop-zone { display: grid; gap: var(--space-2); min-height: 112px; place-content: center; border: 1px dashed var(--color-border); border-radius: var(--radius-md); text-align: center; cursor: pointer; }
    .drop-zone.hovering, .drop-zone:focus-visible { border-color: var(--color-copper); background: color-mix(in srgb, var(--color-copper) 8%, transparent); outline: 2px solid var(--color-focus); outline-offset: 2px; }
    .drop-zone span, small { color: var(--color-muted); } .browse { display: grid; gap: var(--space-1); }
    .breadcrumbs { display: flex; align-items: center; gap: var(--space-2); padding-bottom: var(--space-2); border-bottom: 1px solid var(--color-border); overflow: hidden; }
    .breadcrumbs span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } button { font: inherit; }
    .entry { display: flex; justify-content: space-between; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-ink); padding: var(--space-2); text-align: left; } .entry:hover { background: color-mix(in srgb, var(--color-copper) 8%, transparent); }
    .notice, .error { font-size: 13px; } .error { color: #a33; }
    @media (max-width: 640px) { .picker-heading { display: grid; } }
  `,
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