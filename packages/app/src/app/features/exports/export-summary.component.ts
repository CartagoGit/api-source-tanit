import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";

import { ExportResult } from "../../core/api/exports.client";

/**
 * What was written.
 *
 * It says what the backend actually wrote, and nothing more. The
 * summary used to claim whether Postman was installed — a guess made
 * in the browser, about an application that may not even be on this
 * machine.
 */
@Component({
  selector: "tanit-export-summary",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (result; as current) { <section class="summary" aria-live="polite"><h2>Export complete</h2><p>{{ current.files.length }} file(s) written to <code>{{ current.outputDirectory }}</code>.</p><div class="actions"><button type="button" (click)="openFolder.emit(current.outputDirectory)">Open folder</button><button type="button" (click)="copy(current.files)">Copy paths</button><button type="button" (click)="openPostman.emit()">Open Postman</button></div></section> }`,
  styles: `.summary { display: grid; gap: 10px; padding: 14px; border: 1px solid var(--color-copper); background: color-mix(in srgb, var(--color-copper) 8%, var(--color-panel)); } h2 { margin: 0; font-size: 18px; } p { margin: 0; } code { overflow-wrap: anywhere; } .actions { display: flex; flex-wrap: wrap; gap: 8px; } button { border: 1px solid var(--color-border); background: var(--color-panel); color: var(--color-ink); padding: 8px 10px; cursor: pointer; }`,
})
export class ExportSummaryComponent {
  @Input() result: ExportResult | null = null;
  @Output() readonly openFolder = new EventEmitter<string>();
  @Output() readonly openPostman = new EventEmitter<void>();
  @Output() readonly copyPaths = new EventEmitter<readonly string[]>();

  copy(files: readonly { path: string }[]): void { this.copyPaths.emit(files.map((file) => file.path)); }
}
