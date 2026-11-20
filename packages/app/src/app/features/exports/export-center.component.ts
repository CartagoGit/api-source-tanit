import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from "@angular/core";

export type { ExportSuccessActionsPort } from "../../../../../contracts/interfaces/core/export-success-actions.interface";
import { FolderPickerComponent } from "../home/folder-picker.component";
import { ExportDiagnostic, ExportFormat } from "../../core/api/exports.client";
import { ExportsStore } from "../../core/state/exports.store";
import { ProjectStore } from "../../core/state/project.store";
import { ExportPreviewComponent } from "./export-preview.component";
import { ExportSummaryComponent } from "./export-summary.component";
import { FormatCapabilitiesComponent } from "./format-capabilities.component";
import { I18nService } from "../../core/i18n/i18n.service";

/**
 * The Export Center.
 *
 * Everything it shows comes from the backend's dry run, and the
 * button writes through the backend's export. The preview is not
 * computed in the browser: it is the answer to "what would you
 * write?", asked of the same code that will write it.
 */
@Component({
  selector: "tanit-export-center",
  standalone: true,
  imports: [ExportPreviewComponent, ExportSummaryComponent, FormatCapabilitiesComponent, FolderPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./export-center.component.html",
  styleUrls: ["./export-center.component.scss"],
})
export class ExportCenterComponent {
  readonly i18n = inject(I18nService);
  readonly store = inject(ExportsStore);
  readonly choosingOutput = signal(false);
  readonly copyMessage = signal<string | null>(null);
  private readonly project = inject(ProjectStore);

  constructor() {
    // The dry run is asked for when the project opens. Without this
    // the Export Center showed an empty preview — "nothing would be
    // written" — until the user happened to toggle a format, which
    // is the one thing the preview is supposed to decide.
    effect(() => {
      if (this.project.projectRoot() !== null) untracked(() => { void this.store.refresh(); });
    });
  }

  toggleFormat(format: ExportFormat): void { this.store.toggleFormat(format); }
  defaultDirectory(): string { return `${this.store.workspaceRoot()}/tanit`; }
  chooseOutput(path: string): void {
    this.store.setOutputDirectory(path);
    this.choosingOutput.set(false);
  }
  async generate(): Promise<void> { await this.store.generate(); }
  selectDiagnostic(diagnostic: ExportDiagnostic): void { if (typeof history !== "undefined") history.replaceState(null, "", `${location.pathname}?diagnosticCode=${encodeURIComponent(diagnostic.code)}`); }
  async copyPaths(paths: readonly string[]): Promise<void> {
    try {
      await navigator.clipboard.writeText(paths.join("\n"));
      this.copyMessage.set(this.i18n.translate("common.copied"));
    } catch {
      this.copyMessage.set(this.i18n.translate("common.clipboardUnavailable"));
    }
  }
}
