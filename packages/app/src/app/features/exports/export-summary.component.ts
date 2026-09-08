import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";

import { ExportResult } from "../../core/api/exports.client";

@Component({
  selector: "tanit-export-summary",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (result; as current) { <section class="summary" aria-live="polite"><h2>Export complete</h2><p>{{ current.files.length }} files written to <code>{{ current.outputDirectory }}</code>.</p><div class="actions"><button type="button" (click)="openFolder.emit(current.outputDirectory)">Open folder</button><button type="button" (click)="copy(current.files)">Copy paths</button><button type="button" (click)="openPostman.emit()">Open Postman</button></div>@if (!current.postmanInstalled) { <small>Postman was not detected; the collection is ready to open manually.</small> }</section> }`,
  styles: `.summary { display: grid; gap: 10px; padding: 14px; border: 1px solid var(--color-copper); background: color-mix(in srgb, var(--color-copper) 8%, var(--color-panel)); } h2 { margin: 0; font-size: 18px; } p { margin: 0; } code { overflow-wrap: anywhere; } .actions { display: flex; flex-wrap: wrap; gap: 8px; } button { border: 1px solid var(--color-border); background: var(--color-panel); color: var(--color-ink); padding: 8px 10px; cursor: pointer; } small { color: var(--color-muted); }`,
})
export class ExportSummaryComponent {
  @Input() result: ExportResult | null = null;
  @Output() readonly openFolder = new EventEmitter<string>();
  @Output() readonly openPostman = new EventEmitter<void>();
  @Output() readonly copyPaths = new EventEmitter<readonly string[]>();

  copy(files: readonly { path: string }[]): void { this.copyPaths.emit(files.map((file) => file.path)); }
}