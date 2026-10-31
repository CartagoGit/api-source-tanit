import { Injectable, computed, effect, inject, signal } from "@angular/core";

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

/**
 * The Export Center's state.
 *
 * The preview is a **signal**, not a computed value: it comes from
 * the backend, and the backend has to be asked. It used to be a
 * `computed()` over a `request` the app built itself — a request
 * whose answer was invented, so the preview was invented too, and it
 * changed the moment the user picked a format, with no round trip
 * and no truth behind it.
 */
@Injectable({ providedIn: "root" })
export class ExportsStore {
  private readonly client = inject(ExportsClient);
  private readonly project = inject(ProjectStore);

  /** The formats the user picked. */
  readonly formats = signal<readonly ExportFormat[]>([EXPORT_FORMATS[0]]);
  /** Where the files will go. */
  readonly outputDirectory = signal("");
  /** The project's root — the workspace the files should stay in. */
  readonly workspaceRoot = computed(() => this.project.projectRoot() ?? "");
  /** What the backend would do. */
  readonly preview = signal<ExportDryRun>(emptyPreview());
  /** What the backend can do with each format. */
  readonly capabilities = signal<readonly ExportCapabilities[]>([]);
  /** What was written. */
  readonly result = signal<ExportResult | null>(null);
  readonly overwriteConfirmed = signal(false);
  readonly outsideWorkspaceConfirmed = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly diagnostics = computed<readonly ExportDiagnostic[]>(() => this.preview().diagnostics);

  constructor() {
    // The state belongs to **a** project. When the open project
    // changes, the preview of the previous one is a lie: the Export
    // Center used to keep showing it, with the files of a project
    // that was no longer open.
    let previous: string | null | undefined;
    effect(() => {
      const root = this.project.projectRoot();
      if (root === previous) return;
      previous = root;
      this.preview.set(emptyPreview());
      this.capabilities.set([]);
      this.result.set(null);
      this.overwriteConfirmed.set(false);
      this.outsideWorkspaceConfirmed.set(false);
      this.error.set(null);
    });
  }

  toggleFormat(format: ExportFormat): void {
    const selected = new Set(this.formats());
    if (selected.has(format)) selected.delete(format);
    else selected.add(format);
    this.formats.set(EXPORT_FORMATS.filter((item) => selected.has(item)));
    this.result.set(null);
    // The confirmations were about the previous preview. Carrying
    // them over would let a consent given for one set of files
    // authorise another.
    this.overwriteConfirmed.set(false);
    this.outsideWorkspaceConfirmed.set(false);
    void this.refresh();
  }

  setOutputDirectory(path: string): void {
    this.outputDirectory.set(path);
    this.outsideWorkspaceConfirmed.set(false);
    this.result.set(null);
    void this.refresh();
  }

  confirmOverwrite(value: boolean): void {
    this.overwriteConfirmed.set(value);
  }

  confirmOutsideWorkspace(value: boolean): void {
    this.outsideWorkspaceConfirmed.set(value);
  }

  /**
   * Asks the backend what it would write.
   *
   * Nothing happens without a project: the API needs a session, and
   * a session needs a root.
   */
  async refresh(): Promise<void> {
    const projectRoot = this.project.projectRoot();
    if (projectRoot === null) return;
    if (this.formats().length === 0) {
      this.preview.set(emptyPreview());
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const directory = this.outputDirectory() || `${this.workspaceRoot()}/tanit`;
      const previews = await Promise.all(
        this.formats().map((format) =>
          this.client.preview(projectRoot, format, directory, this.workspaceRoot()),
        ),
      );
      this.preview.set(merge(previews));
      this.capabilities.set(await this.client.capabilities(projectRoot));
    } catch (error) {
      this.error.set(describe(error));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Writes the files.
   *
   * The overwrite is confirmed **here**, not in the backend: the
   * backend is asked to write what the preview showed, and the app
   * is the one that asked the user.
   *
   * And the confirmation is **honoured**: the two checkboxes were
   * drawn, the preview said "existing files may be overwritten", and
   * `generate()` wrote anyway. A checkbox that asks permission and
   * ignores the answer is worse than no checkbox: it teaches the
   * user that the warning does not matter.
   */
  async generate(): Promise<void> {
    const projectRoot = this.project.projectRoot();
    if (projectRoot === null) return;
    const preview = this.preview();
    if (preview.requiresOverwriteConfirmation && !this.overwriteConfirmed()) {
      this.error.set("Confirm the overwrite of the existing files before generating.");
      return;
    }
    if (preview.requiresOutsideWorkspaceConfirmation && !this.outsideWorkspaceConfirmed()) {
      this.error.set("Confirm that the output goes outside the project before generating.");
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const directory = this.outputDirectory() || `${this.workspaceRoot()}/tanit`;
      const written: Array<{ path: string }> = [];
      for (const format of this.formats()) {
        const result = await this.client.generate(projectRoot, format, directory);
        written.push(...result.files);
      }
      this.result.set({ files: written, outputDirectory: directory });
      // The confirmation was about **these** files. Asking again
      // for the next one is the difference between a consent and a
      // habit.
      this.overwriteConfirmed.set(false);
      this.outsideWorkspaceConfirmed.set(false);
    } catch (error) {
      this.error.set(describe(error));
    } finally {
      this.loading.set(false);
    }
  }
}

/** A preview with nothing in it. */
function emptyPreview(): ExportDryRun {
  return {
    files: [],
    diagnostics: [],
    canGenerate: false,
    requiresOverwriteConfirmation: false,
    requiresOutsideWorkspaceConfirmation: false,
  };
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
