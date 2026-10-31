import { ChangeDetectionStrategy, Component, Injectable, effect, inject } from "@angular/core";

import type { ExportSuccessActionsPort } from "../../../../../contracts/interfaces/core/export-success-actions.interface";
export type { ExportSuccessActionsPort } from "../../../../../contracts/interfaces/core/export-success-actions.interface";
import { DialogService } from "../../core/host/dialog.service";
import { ExportDiagnostic, ExportFormat } from "../../core/api/exports.client";
import { ExportsStore } from "../../core/state/exports.store";
import { ProjectStore } from "../../core/state/project.store";
import { ExportPreviewComponent } from "./export-preview.component";
import { ExportSummaryComponent } from "./export-summary.component";
import { FormatCapabilitiesComponent } from "./format-capabilities.component";

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
  imports: [ExportPreviewComponent, ExportSummaryComponent, FormatCapabilitiesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./export-center.component.html",
  styleUrls: ["./export-center.component.scss"],
})
export class ExportCenterComponent {
  readonly store = inject(ExportsStore);
  readonly dialog = inject(DialogService);
  readonly actions = inject(ExportSuccessActions);
  private readonly project = inject(ProjectStore);

  constructor() {
    // The dry run is asked for when the project opens. Without this
    // the Export Center showed an empty preview — "nothing would be
    // written" — until the user happened to toggle a format, which
    // is the one thing the preview is supposed to decide.
    effect(() => {
      if (this.project.projectRoot() !== null) void this.store.refresh();
    });
  }

  toggleFormat(format: ExportFormat): void { this.store.toggleFormat(format); }
  defaultDirectory(): string { return `${this.store.workspaceRoot()}/tanit`; }
  async chooseOutput(): Promise<void> { const path = await this.dialog.pickFolder(); if (path) this.store.setOutputDirectory(path); }
  async generate(): Promise<void> { await this.store.generate(); }
  selectDiagnostic(diagnostic: ExportDiagnostic): void { if (typeof history !== "undefined") history.replaceState(null, "", `${location.pathname}?diagnosticCode=${encodeURIComponent(diagnostic.code)}`); }
  async openFolder(path: string): Promise<void> { await this.actions.openFolder(path); }
  async openPostman(): Promise<void> { await this.actions.openPostman(); }
  async copyPaths(paths: readonly string[]): Promise<void> { if (typeof navigator !== "undefined" && navigator.clipboard) await navigator.clipboard.writeText(paths.join("\n")); }
}

@Injectable({ providedIn: "root" })
export class ExportSuccessActions implements ExportSuccessActionsPort {
  async openFolder(path: string): Promise<void> {
    const tauri = (globalThis as { __TAURI__?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI__;
    if (tauri?.invoke) {
      await tauri.invoke("open_folder", { path });
      return;
    }
    if (typeof window !== "undefined") window.open(`tanit://open-folder?path=${encodeURIComponent(path)}`, "_blank");
  }

  async openPostman(): Promise<void> {
    const tauri = (globalThis as { __TAURI__?: { invoke?: (command: string) => Promise<unknown> } }).__TAURI__;
    if (tauri?.invoke) {
      await tauri.invoke("open_postman");
      return;
    }
    if (typeof window !== "undefined") window.open("tanit://open-postman", "_blank");
  }
}
