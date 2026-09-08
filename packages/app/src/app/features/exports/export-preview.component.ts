import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";

import { ExportDiagnostic, ExportDryRun } from "../../core/api/exports.client";

@Component({
  selector: "tanit-export-preview",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="preview" aria-labelledby="preview-title"><header><div><h2 id="preview-title">Dry run</h2><p>Files and overwrite risk before generation.</p></div><strong>{{ preview.canGenerate ? "Ready" : "Needs confirmation" }}</strong></header>@if (preview.combinedExport; as combined) { <aside class="combined" [attr.data-partial]="combined.partial"><strong>{{ combined.partial ? "Partial combined export" : "Combined export" }}</strong><p>{{ combined.explanation }}</p>@for (service of combined.services; track service.serviceId) { <small>{{ service.serviceId }}: {{ service.reason }}</small> }</aside> }<div class="files">@for (file of preview.files; track file.path) { <div class="file"><span>{{ file.change }}</span><code>{{ file.path }}</code>@if (file.overwriteRisk) { <small>Overwrite risk</small> } @if (file.outsideWorkspace) { <small>Outside workspace</small> }</div> }</div>@if (preview.diagnostics.length) { <div class="diagnostics" aria-live="polite">@for (diagnostic of preview.diagnostics; track diagnostic.code) { <button type="button" (click)="diagnosticSelected.emit(diagnostic)"><strong>{{ diagnostic.code }}</strong><span>{{ diagnostic.message }}</span><small>{{ diagnostic.suggestion }}</small></button> }</div> }</section>`,
  styles: `.preview { display: grid; gap: 12px; } header { display: flex; justify-content: space-between; gap: 12px; } h2 { margin: 0; font-size: 18px; } p { margin: 4px 0 0; color: var(--color-muted); } .files, .diagnostics { display: grid; gap: 6px; } .file { display: grid; grid-template-columns: 82px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 9px 10px; border-bottom: 1px solid var(--color-border); } code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { color: var(--color-muted); font-size: 11px; } .diagnostics button { display: grid; gap: 3px; padding: 9px; border: 1px solid var(--color-border); background: transparent; color: var(--color-ink); text-align: left; cursor: pointer; } .diagnostics span { color: var(--color-muted); }`,
})
export class ExportPreviewComponent {
  @Input() preview: ExportDryRun = { files: [], diagnostics: [], canGenerate: false, requiresOverwriteConfirmation: false, requiresOutsideWorkspaceConfirmation: false };
  @Output() readonly diagnosticSelected = new EventEmitter<ExportDiagnostic>();
}