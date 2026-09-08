import { ChangeDetectionStrategy, Component, Injectable, inject } from "@angular/core";

import { DialogService } from "../../core/host/dialog.service";
import { ExportDiagnostic, ExportFormat } from "../../core/api/exports.client";
import { ExportsStore } from "../../core/state/exports.store";
import { ExportPreviewComponent } from "./export-preview.component";
import { ExportSummaryComponent } from "./export-summary.component";
import { FormatCapabilitiesComponent } from "./format-capabilities.component";

@Component({
  selector: "tanit-export-center",
  standalone: true,
  imports: [ExportPreviewComponent, ExportSummaryComponent, FormatCapabilitiesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="center"><header><div><span class="eyebrow">Export Center</span><h1>Generate API artifacts</h1><p>Choose formats, inspect the dry run, then confirm the destination.</p></div><button type="button" [disabled]="!store.preview().canGenerate" (click)="generate()">Generate</button></header><tanit-format-capabilities [capabilities]="store.capabilities()" [selected]="store.formats()" (changed)="toggleFormat($event)" /><section class="destination"><div><h2>Output directory</h2><code>{{ store.outputDirectory() }}</code>@if (store.preview().requiresOutsideWorkspaceConfirmation) { <p class="warning">This directory is outside the workspace.</p> }@if (store.preview().requiresOverwriteConfirmation) { <p class="warning">Existing files may be overwritten.</p> }</div><button type="button" (click)="chooseOutput()">Choose directory</button></section><label class="check"><input type="checkbox" [checked]="store.overwriteConfirmed()" (change)="store.confirmOverwrite($any($event.target).checked)" /> Confirm overwrite of existing files</label>@if (store.preview().requiresOutsideWorkspaceConfirmation) { <label class="check"><input type="checkbox" [checked]="store.outsideWorkspaceConfirmed()" (change)="store.confirmOutsideWorkspace($any($event.target).checked)" /> Confirm output outside workspace</label> }<tanit-export-preview [preview]="store.preview()" (diagnosticSelected)="selectDiagnostic($event)" /><tanit-export-summary [result]="store.result()" (openFolder)="openFolder($event)" (openPostman)="openPostman()" (copyPaths)="copyPaths($event)" />@if (store.error(); as error) { <p class="error" role="alert">{{ error }}</p> }</section>`,
  styles: `.center { display: grid; gap: 20px; max-width: 980px; } header, .destination { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; } h1 { margin: 5px 0; font-size: 32px; } h2 { margin: 0 0 5px; font-size: 18px; } p { margin: 0; color: var(--color-muted); } .eyebrow, .warning { color: var(--color-copper-strong); } header > button, .destination > button { border: 1px solid var(--color-copper); background: var(--color-copper); color: white; padding: 10px 14px; cursor: pointer; } header > button:disabled { opacity: .45; cursor: not-allowed; } .destination { padding: 14px 0; border-top: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border); } code { overflow-wrap: anywhere; } .check { display: flex; align-items: center; gap: 8px; } .warning, .error { font-size: 13px; } .error { color: #a33; } @media (max-width: 640px) { header, .destination { display: grid; } }`,
})
export class ExportCenterComponent {
  readonly store = inject(ExportsStore);
  readonly dialog = inject(DialogService);
  readonly actions = inject(ExportSuccessActions);

  toggleFormat(format: ExportFormat): void { this.store.toggleFormat(format); }
  async chooseOutput(): Promise<void> { const path = await this.dialog.pickFolder(); if (path) this.store.setOutputDirectory(path); }
  async generate(): Promise<void> { await this.store.generate(); }
  selectDiagnostic(diagnostic: ExportDiagnostic): void { if (typeof history !== "undefined") history.replaceState(null, "", `${location.pathname}?diagnosticCode=${encodeURIComponent(diagnostic.code)}`); }
  async openFolder(path: string): Promise<void> { await this.actions.openFolder(path); }
  async openPostman(): Promise<void> { await this.actions.openPostman(); }
  async copyPaths(paths: readonly string[]): Promise<void> { if (typeof navigator !== "undefined" && navigator.clipboard) await navigator.clipboard.writeText(paths.join("\n")); }
}

export interface ExportSuccessActionsPort {
  openFolder(path: string): Promise<void>;
  openPostman(): Promise<void>;
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