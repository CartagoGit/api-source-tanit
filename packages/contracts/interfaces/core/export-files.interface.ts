import type { IExportFilePreview, IExportPlan } from "./application-api.interface.js";
import type { ExportFormatId } from "./exporter.interface.js";

/** One prepared file, including the exact bytes the shared writer will use. */
export interface IPreparedExportFile extends IExportFilePreview {
  readonly content: string;
}

/** A format built and validated before any filesystem writes. */
export interface IPreparedExport extends IExportPlan {
  readonly format: ExportFormatId;
  readonly artifact?: unknown;
  readonly files: ReadonlyArray<IPreparedExportFile>;
}
