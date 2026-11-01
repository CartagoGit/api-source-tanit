import type { z, ZodType } from "zod";
import type {
  BrowseInputSchema,
  CancelInputSchema,
  CheckInputSchema,
  CloseInputSchema,
  DryRunInputSchema,
  EndpointSummarySchema,
  ExportInputSchema,
  GetEndpointInputSchema,
  GetSchemaInputSchema,
  HistoryCompareConfigInputSchema,
  HistoryDiffInputSchema,
  HistoryInputSchema,
  HistoryListInputSchema,
  HistoryReExportInputSchema,
  HistoryRestoreInputSchema,
  ListEndpointsInputSchema,
  ListProjectsInputSchema,
  ListServicesInputSchema,
  OpenProjectInputSchema,
  ProjectEntrySchema,
  PushInputSchema,
  ServiceDetailInputSchema,
  SettingsInputSchema,
  SnapshotInputSchema,
  SnapshotSummarySchema,
  ServiceSummarySchema,
  StatsInputSchema,
  SyncInputSchema,
  ValidateInputSchema,
  WatchInputSchema,
} from "../../constants/core/application-api.constant.js";
import type { EndpointSpec } from "./endpoint-legacy.interface.js";
import type { IBrowseListing } from "./browse.interface.js";
import type { IExporterDiagnostic } from "./exporter.interface.js";
import type { IHistoryDiff, IHistorySummary } from "./history.interface.js";
import type { IServiceDetail } from "./services.interface.js";
import type {
  IPushedArtifact,
  IPushFailure,
} from "../cli/push-outcome.interface.js";

export interface IAbortSignalLike { readonly aborted: boolean; }
export interface IRequestContext {
  readonly sessionId?: string;
  readonly signal?: IAbortSignalLike;
  readonly caller: "desktop" | "browser" | "cli";
  readonly workspace?: string;
  readonly orchestrator?: unknown;
}
export interface IHandler<TIn, TOut> {
  readonly name: string;
  readonly input: ZodType<TIn>;
  readonly handle: (input: TIn, ctx: IRequestContext) => Promise<TOut>;
}
export type HandlerRegistry = Readonly<Record<string, IHandler<unknown, unknown>>>;

export type ApiErrorCode = "INVALID_INPUT" | "UNKNOWN_HANDLER" | "SESSION_NOT_FOUND" | "OPERATION_NOT_FOUND" | "SERVICE_NOT_FOUND" | "CANCELED" | "EXECUTION_FAILED" | "EXPORT_FAILED";
export interface IApiError {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}
export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: IApiError };

export type OpenProjectInput = z.infer<typeof OpenProjectInputSchema>;
export type SnapshotInput = z.infer<typeof SnapshotInputSchema>;
export type ListEndpointsInput = z.infer<typeof ListEndpointsInputSchema>;
export type GetEndpointInput = z.infer<typeof GetEndpointInputSchema>;
export type GetSchemaInput = z.infer<typeof GetSchemaInputSchema>;
export type ListServicesInput = z.infer<typeof ListServicesInputSchema>;
export type DryRunInput = z.infer<typeof DryRunInputSchema>;
export type ExportInput = z.infer<typeof ExportInputSchema>;
export type HistoryInput = z.infer<typeof HistoryInputSchema>;
export type HistoryListInput = z.infer<typeof HistoryListInputSchema>;
export type HistoryDiffInput = z.infer<typeof HistoryDiffInputSchema>;
export type HistoryCompareConfigInput = z.infer<typeof HistoryCompareConfigInputSchema>;
export type HistoryReExportInput = z.infer<typeof HistoryReExportInputSchema>;
export type HistoryRestoreInput = z.infer<typeof HistoryRestoreInputSchema>;
export type ServiceDetailInput = z.infer<typeof ServiceDetailInputSchema>;
export type WatchInput = z.infer<typeof WatchInputSchema>;
export type CancelInput = z.infer<typeof CancelInputSchema>;
export type SettingsInput = z.infer<typeof SettingsInputSchema>;
export type ListProjectsInput = z.infer<typeof ListProjectsInputSchema>;
export type BrowseInput = z.infer<typeof BrowseInputSchema>;
export type CloseInput = z.infer<typeof CloseInputSchema>;
export type CheckInput = z.infer<typeof CheckInputSchema>;
export type ValidateInput = z.infer<typeof ValidateInputSchema>;
export type StatsInput = z.infer<typeof StatsInputSchema>;
export type PushInput = z.infer<typeof PushInputSchema>;
export type SyncInput = z.infer<typeof SyncInputSchema>;
export type IEndpointSummary = z.infer<typeof EndpointSummarySchema>;
export type IServiceSummary = z.infer<typeof ServiceSummarySchema>;
export type ISnapshotSummary = z.infer<typeof SnapshotSummarySchema>;
export type IProjectEntry = z.infer<typeof ProjectEntrySchema>;

export interface OpenProjectOutput { readonly sessionId: string; readonly summary: ISnapshotSummary; }
export interface SnapshotOutput { readonly summary: ISnapshotSummary; }
/**
 * One thing the backend noticed about the project.
 *
 * The app's Diagnostics section draws these. It used to draw
 * nothing: the section was in the sidebar, the shell had no case for
 * it, and it fell through to the empty state — a navigation entry
 * that led to a blank page.
 */
export interface IProjectDiagnostic {
  readonly severity: "error" | "warning";
  /** What happened, in words a person can read. */
  readonly message: string;
  /** Which scanner produced it, when it knows. */
  readonly source?: string;
}
export interface ListEndpointsOutput { readonly endpoints: ReadonlyArray<IEndpointSummary>; readonly nextCursor: string | null; readonly total: number; readonly indexedTotal: number; }
export interface GetEndpointOutput { readonly endpoint: EndpointSpec; readonly serviceId: string; }
export type IRequestSchema =
  | { readonly kind: "fields"; readonly fields: ReadonlyArray<unknown> }
  | { readonly kind: "body"; readonly body: unknown }
  | { readonly kind: "none" };
export interface GetSchemaOutput { readonly schema: IRequestSchema; }
export interface ListServicesOutput { readonly services: ReadonlyArray<IServiceSummary>; }
/** What would happen to one file. */
export type ExportChange = "NEW" | "UPDATE" | "UNCHANGED";
/** One file, before it is written. */
export interface IExportFilePreview {
  readonly path: string;
  readonly change: ExportChange;
  readonly bytes: number;
}
/** The files a snapshot would produce, and what would happen to them. */
export interface IExportPlan {
  readonly files: ReadonlyArray<IExportFilePreview>;
  /** The path of the primary artifact. */
  readonly outputPath: string;
  /** What the exporters had to say. */
  readonly diagnostics: ReadonlyArray<IExporterDiagnostic>;
}
export interface DryRunOutput { readonly endpointCount: number; readonly frameworks: ReadonlyArray<string>; readonly warnings: ReadonlyArray<string>; readonly durationMs: number; readonly files: ReadonlyArray<IExportFilePreview>; readonly formats: ReadonlyArray<IExportFormatSummary>; readonly diagnostics: ReadonlyArray<IExporterDiagnostic>; }
/** What a format can and cannot represent, in the core's own words. */
export interface IExportFormatSummary { readonly id: string; readonly summary: string; }
export interface ExportOutput { readonly outputPath: string; readonly bytes: number; readonly files: ReadonlyArray<string>; /**
   * The revision this export left in the project's history.
   *
   * It is there so the app can say "this is revision X" instead of
   * guessing: the export and the history entry are the same moment.
   */
readonly historyId?: string; }
export type IHistoryEntry =
  | { readonly kind: "snapshot-ready"; readonly capturedAt: string; readonly sessionId: string }
  | { readonly kind: "snapshot-stale"; readonly capturedAt: string; readonly changedPaths: ReadonlyArray<string> };
export interface HistoryOutput { readonly entries: ReadonlyArray<IHistoryEntry>; readonly total: number; }
/**
 * The persisted history of a project.
 *
 * The revisions are the **metadata** of each record: when it was
 * made, what it contained, how it was configured. The whole snapshot
 * is not here — it is on disk, and the operations that need it (diff,
 * re-export, restore) go and read it.
 */
export interface HistoryListOutput {
  readonly entries: ReadonlyArray<IHistorySummary>;
  readonly total: number;
}
/**
 * What changed between two revisions.
 *
 * It is the diff **in the root**, without a wrapper: the app's screen
 * reads `result.added` and `result.serviceChanges` directly, and a
 * wrapper would have been a level of nesting for nothing.
 */
export type HistoryDiffOutput = IHistoryDiff;
/** How two revisions were configured, side by side. */
export interface HistoryCompareConfigOutput {
  readonly before: Readonly<Record<string, unknown>>;
  readonly after: Readonly<Record<string, unknown>>;
}
/** A revision, exported again. */
export type HistoryReExportOutput = ExportOutput;
/** A revision, restored. */
export interface HistoryRestoreOutput {
  /** `true` when the collection was written. */
  readonly restored: boolean;
  /** The revision that was restored. */
  readonly historyId: string;
  /** Where it was written. */
  readonly outputPath: string;
}
/** One service, with everything known about it. */
export interface ServiceDetailOutput {
  readonly service: IServiceDetail;
}
export interface WatchSubscription { readonly subscriptionId: string; readonly projectRoot: string; readonly onlyPaths: ReadonlyArray<string> | null; }
export interface WatchOutput { readonly subscription: WatchSubscription; }
export interface CancelOutput { readonly cancelled: number; }
export interface SettingsOutput { readonly applied: Readonly<Record<string, unknown>>; }
export interface ListProjectsOutput { readonly projects: ReadonlyArray<IProjectEntry>; }
export interface BrowseOutput { readonly listing: IBrowseListing; }
export interface CloseOutput { readonly closed: number; }

/* ------------------------------------------------------------------ *
 * The verbs that used to be CLI-only.
 * ------------------------------------------------------------------ */

/** One route, as the two sides of a drift comparison see it. */
export interface IDriftedEndpoint {
  readonly method: string;
  readonly uri: string;
  readonly name?: string | undefined;
}

/**
 * The drift between the routes in the code and the collection on disk.
 *
 * It lives here, and not only in the CLI's contract, because the
 * comparison stopped being a CLI thing: the Application API answers
 * it too, and the MCP plugin reads the same report. Three consumers
 * and one declaration — a report that is declared twice is a report
 * that answers two questions.
 */
export interface ICheckReport {
  /** `true` when both sides carry the same routes. */
  readonly inSync: boolean;
  /** How many routes the code declares. */
  readonly routesInSource: number;
  /** How many requests the collection carries. */
  readonly requestsInCollection: number;
  /** Routes the code declares and the collection does not have. */
  readonly missingInCollection: ReadonlyArray<IDriftedEndpoint>;
  /** Requests the collection carries and the code does not declare. */
  readonly missingInSource: ReadonlyArray<IDriftedEndpoint>;
  /** The collection that was compared. */
  readonly collectionPath: string;
}
export interface CheckOutput { readonly report: ICheckReport; }

/** How bad a validation issue is. */
export type ValidationSeverity = "error" | "warning";
/** One thing that is wrong with a collection. */
export interface IValidationIssue {
  readonly severity: ValidationSeverity;
  readonly message: string;
}
export interface IValidationResult {
  /** `true` when there is no error. Warnings do not make it false. */
  readonly ok: boolean;
  readonly errors: ReadonlyArray<IValidationIssue>;
  readonly warnings: ReadonlyArray<IValidationIssue>;
  readonly requests: number;
  readonly folders: number;
  readonly variables: number;
  readonly collectionPath: string;
}
export interface ValidateOutput { readonly result: IValidationResult; }

/** The count of one HTTP method. */
export interface IMethodCount {
  readonly method: string;
  readonly count: number;
}
/** The count of one folder. */
export interface IFolderCount {
  readonly folder: string;
  readonly count: number;
}
/** The counts of one zone. */
export interface IZoneStats {
  readonly zone: string;
  readonly total: number;
  readonly byFolder: ReadonlyArray<IFolderCount>;
}
export interface IStatsResult {
  readonly total: number;
  readonly byMethod: ReadonlyArray<IMethodCount>;
  readonly zones: ReadonlyArray<IZoneStats>;
  /** The collection that was measured. */
  readonly collectionPath: string;
}
export interface StatsOutput { readonly stats: IStatsResult; }

export interface PushOutput {
  /** The Postman account the key belongs to. */
  readonly user: string | null;
  /** The framework that recognized the project. */
  readonly framework: string | null;
  readonly requests: number;
  readonly collection: IPushedArtifact | null;
  readonly environments: ReadonlyArray<IPushedArtifact>;
  /** `null` when everything went well. */
  readonly error: IPushFailure | null;
  /** `true` when nothing was uploaded: it was a dry run. */
  readonly dryRun: boolean;
}
export interface SyncOutput {
  /** The files that were written — empty on a dry run. */
  readonly files: ReadonlyArray<string>;
  readonly bytes: number;
  /** The files that **would** be written. Always filled. */
  readonly plannedFiles: ReadonlyArray<IExportFilePreview>;
  readonly endpointCount: number;
  readonly frameworks: ReadonlyArray<string>;
  readonly dryRun: boolean;
  /** What the exporters had to say. */
  readonly diagnostics: ReadonlyArray<IExporterDiagnostic>;
}