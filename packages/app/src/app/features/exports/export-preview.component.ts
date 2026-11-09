import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from "@angular/core";

import { ExportDiagnostic, ExportDryRun } from "../../core/api/exports.client";
import { I18nService } from "../../core/i18n/i18n.service";

/**
 * The dry run, as the backend described it.
 *
 * Every path and every size here was computed by the backend from the
 * artifacts it would really write. The preview the app used to draw
 * was computed by the app from a request it had made up, and it
 * showed paths and sizes that had nothing to do with the files the
 * exporter produces.
 */
@Component({
  selector: "tanit-export-preview",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./export-preview.component.html",
  styleUrls: ["./export-preview.component.scss"],
})
export class ExportPreviewComponent {
  readonly i18n = inject(I18nService);
  @Input() preview: ExportDryRun = {
    files: [],
    diagnostics: [],
    canGenerate: false,
    requiresOverwriteConfirmation: false,
    requiresOutsideWorkspaceConfirmation: false,
  };
  @Output() readonly diagnosticSelected = new EventEmitter<ExportDiagnostic>();
}
