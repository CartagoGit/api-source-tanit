import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";

import { ExportCapabilities, ExportFormat } from "../../core/api/exports.client";

/**
 * The formats the user can pick.
 *
 * The card shows what the **core** says each format does. The app
 * used to carry its own descriptions — "Collection and environment
 * compatible with Postman", "Canonical HTTP contract with schemas
 * and responses" — written by hand, never checked against the
 * exporter, and wrong the day an exporter changed. The backend says
 * what each one does now.
 */
@Component({
  selector: "tanit-format-capabilities",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="capabilities" aria-labelledby="formats-title"><h2 id="formats-title">Formats</h2><div class="format-grid">@for (item of capabilities; track item.format) { <button type="button" class="format" [class.selected]="selected.includes(item.format)" (click)="changed.emit(item.format)" [attr.aria-pressed]="selected.includes(item.format)"><strong>{{ item.label }}</strong><small>{{ item.summary }}</small></button> }</div></section>`,
  styles: `.capabilities { display: grid; gap: 12px; } h2 { margin: 0; font-size: 18px; } .format-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; } .format { display: grid; gap: 5px; min-height: 78px; padding: 12px; border: 1px solid var(--color-border); background: var(--color-panel); color: var(--color-ink); text-align: left; cursor: pointer; } .format.selected { border-color: var(--color-copper); background: color-mix(in srgb, var(--color-copper) 10%, var(--color-panel)); } small { color: var(--color-muted); font-size: 12px; } @media (max-width: 700px) { .format-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }`,
})
export class FormatCapabilitiesComponent {
  @Input() capabilities: readonly ExportCapabilities[] = [];
  @Input() selected: readonly ExportFormat[] = [];
  @Output() readonly changed = new EventEmitter<ExportFormat>();
}
