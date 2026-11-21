import { Injectable, computed, inject, signal } from "@angular/core";

import {
  EXPORT_FORMATS,
  ExportCapabilities,
  ExportDiagnostic,
  ExportDryRun,
  ExportFormat,
  ExportResult,
  ExportsClient,
} from "../api/exports.client";
import { ProjectStore } from "./project.store";
import { I18nService } from "../i18n/i18n.service";

interface IExportSession {
  readonly root: string | null;
  readonly id: string | null;
}

interface IExportSelection {
  readonly session: IExportSession;
  readonly directory: string;
  readonly formats: readonly ExportFormat[];
}

interface IExportView {
  readonly preview: ExportDryRun;
  readonly result: ExportResult | null;
  readonly overwriteConfirmed: boolean;
  readonly outsideWorkspaceConfirmed: boolean;
  readonly previewLoading: boolean;
  readonly error: string | null;
}

const EMPTY_VIEW: IExportView = {
  preview: {
    files: [],
    diagnostics: [],
    canGenerate: false,
    requiresOverwriteConfirmation: false,
    requiresOutsideWorkspaceConfirmation: false,
  },
  result: null,
  overwriteConfirmed: false,
  outsideWorkspaceConfirmed: false,
  previewLoading: false,
  error: null,
};

/** Holds the backend's preview and write result for the current export selection. */
@Injectable({ providedIn: "root" })
export class ExportsStore {
  private readonly i18n = inject(I18nService);
  private readonly client = inject(ExportsClient);
  private readonly project = inject(ProjectStore);

  readonly formats = signal<readonly ExportFormat[]>([EXPORT_FORMATS[0]]);
  readonly workspaceRoot = computed(() => this.project.projectRoot() ?? "");

  private readonly session = computed<IExportSession>(() => ({
    root: this.project.projectRoot(),
    id: this.project.sessionId(),
  }));
  private readonly destination = signal<{ session: IExportSession; path: string } | null>(null);
  readonly outputDirectory = computed(() => {
    const destination = this.destination();
    return destination?.session === this.session() ? destination.path : "";
  });

  private readonly selection = computed<IExportSelection>(() => ({
    session: this.session(),
    directory: this.outputDirectory() || `${this.workspaceRoot()}/tanit`,
    formats: this.formats(),
  }));
  private readonly state = signal<{ selection: IExportSelection; view: IExportView } | null>(null);
  private readonly availableFormats = signal<{ session: IExportSession; formats: readonly ExportCapabilities[] } | null>(null);
  private readonly view = computed(() => {
    const state = this.state();
    return state?.selection === this.selection() ? state.view : EMPTY_VIEW;
  });
  private readonly writing = signal(false);
  private refreshId = 0;

  readonly preview = computed(() => this.view().preview);
  readonly capabilities = computed(() => {
    const available = this.availableFormats();
    return available?.session === this.session() ? available.formats : [];
  });
  readonly result = computed(() => this.view().result);
  readonly overwriteConfirmed = computed(() => this.view().overwriteConfirmed);
  readonly outsideWorkspaceConfirmed = computed(() => this.view().outsideWorkspaceConfirmed);
  readonly loading = computed(() => this.view().previewLoading || this.writing());
  readonly error = computed(() => this.view().error);
  readonly diagnostics = computed<readonly ExportDiagnostic[]>(() => this.preview().diagnostics);

  toggleFormat(format: ExportFormat): void {
    const selected = new Set(this.formats());
    if (selected.has(format)) selected.delete(format);
    else selected.add(format);
    this.formats.set(EXPORT_FORMATS.filter((item) => selected.has(item)));
    void this.refresh();
  }

  setOutputDirectory(path: string): void {
    this.destination.set({ session: this.session(), path });
    void this.refresh();
  }

  confirmOverwrite(value: boolean): void {
    this.update(this.selection(), { overwriteConfirmed: value });
  }

  confirmOutsideWorkspace(value: boolean): void {
    this.update(this.selection(), { outsideWorkspaceConfirmed: value });
  }

  /** Returns true when this call prepared the current selection. */
  async refresh(): Promise<boolean> {
    const selection = this.selection();
    const { session, directory, formats } = selection;
    const root = session.root;
    if (root === null) return false;

    const id = ++this.refreshId;
    const current = (): boolean => id === this.refreshId && selection === this.selection();
    this.update(selection, {
      preview: EMPTY_VIEW.preview,
      previewLoading: true,
      overwriteConfirmed: false,
      outsideWorkspaceConfirmed: false,
      error: null,
    });

    try {
      const previews = await Promise.all(formats.map((format) => this.client.preview(root, format, directory)));
      if (!current()) return false;
      this.update(selection, { preview: merge(previews) });

      if (this.availableFormats()?.session !== session) {
        const capabilities = await this.client.capabilities(root);
        if (!current()) return false;
        this.availableFormats.set({ session, formats: capabilities });
      }
      return formats.length > 0;
    } catch (error) {
      if (current()) this.update(selection, { error: describe(error) });
      return false;
    } finally {
      if (current()) this.update(selection, { previewLoading: false });
    }
  }

  /** Regenerate previously approved artifacts through the normal preview/write path. */
  async regenerate(): Promise<void> {
    if (this.writing()) return;
    const selection = this.selection();
    const previous = new Set(this.result()?.files.map((file) => file.path) ?? []);
    if (!(await this.refresh()) || selection !== this.selection()) return;

    const files = this.preview().files;
    if (files.length > 0 && files.every((file) => previous.has(file.path))) {
      this.confirmOverwrite(true);
      this.confirmOutsideWorkspace(true);
    }
    await this.generate();
  }

  /** Writes the formats covered by the current preview and consumes consent. */
  async generate(): Promise<void> {
    const selection = this.selection();
    const { session, directory, formats } = selection;
    const { preview, overwriteConfirmed, outsideWorkspaceConfirmed } = this.view();
    const root = session.root;
    if (root === null || this.loading() || !preview.canGenerate) return;
    if (preview.requiresOverwriteConfirmation && !overwriteConfirmed) {
      this.update(selection, { error: this.i18n.translate("common.confirmOverwrite") });
      return;
    }
    if (preview.requiresOutsideWorkspaceConfirmation && !outsideWorkspaceConfirmed) {
      this.update(selection, { error: this.i18n.translate("common.confirmOutside") });
      return;
    }

    this.writing.set(true);
    this.update(selection, { error: null, overwriteConfirmed: false, outsideWorkspaceConfirmed: false });

    try {
      const written: Array<{ path: string }> = [];
      for (const format of formats) {
        if (selection !== this.selection()) return;
        const result = await this.client.generate(root, format, directory);
        written.push(...result.files);
      }
      this.update(selection, { result: { files: written, outputDirectory: directory } });
    } catch (error) {
      this.update(selection, { error: describe(error) });
    } finally {
      this.writing.set(false);
    }
  }

  private update(selection: IExportSelection, changes: Partial<IExportView>): void {
    if (selection !== this.selection()) return;
    this.state.set({ selection, view: { ...this.view(), ...changes } });
  }
}

/** The previews of several formats, as one. */
function merge(previews: readonly ExportDryRun[]): ExportDryRun {
  return {
    files: previews.flatMap((preview) => preview.files),
    diagnostics: previews.flatMap((preview) => preview.diagnostics),
    canGenerate: previews.some((preview) => preview.canGenerate),
    requiresOverwriteConfirmation: previews.some(
      (preview) => preview.requiresOverwriteConfirmation,
    ),
    requiresOutsideWorkspaceConfirmation: previews.some(
      (preview) => preview.requiresOutsideWorkspaceConfirmation,
    ),
  };
}

/** The message of a failure, in words a person can read. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
