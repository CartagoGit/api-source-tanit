import type { z, ZodType } from "zod";
import type {
  CancelInputSchema,
  CloseInputSchema,
  DryRunInputSchema,
  EndpointSummarySchema,
  ExportInputSchema,
  GetEndpointInputSchema,
  GetSchemaInputSchema,
  HistoryInputSchema,
  ListEndpointsInputSchema,
  ListProjectsInputSchema,
  ListServicesInputSchema,
  OpenProjectInputSchema,
  ProjectEntrySchema,
  SettingsInputSchema,
  SnapshotInputSchema,
  SnapshotSummarySchema,
  ServiceSummarySchema,
  WatchInputSchema,
} from "../../constants/core/application-api.constant.js";
import type { EndpointSpec } from "./postman.interface.js";

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
export type WatchInput = z.infer<typeof WatchInputSchema>;
export type CancelInput = z.infer<typeof CancelInputSchema>;
export type SettingsInput = z.infer<typeof SettingsInputSchema>;
export type ListProjectsInput = z.infer<typeof ListProjectsInputSchema>;
export type CloseInput = z.infer<typeof CloseInputSchema>;
export type IEndpointSummary = z.infer<typeof EndpointSummarySchema>;
export type IServiceSummary = z.infer<typeof ServiceSummarySchema>;
export type ISnapshotSummary = z.infer<typeof SnapshotSummarySchema>;
export type IProjectEntry = z.infer<typeof ProjectEntrySchema>;

export interface OpenProjectOutput { readonly sessionId: string; readonly summary: ISnapshotSummary; }
export interface SnapshotOutput { readonly summary: ISnapshotSummary; }
export interface ListEndpointsOutput { readonly endpoints: ReadonlyArray<IEndpointSummary>; readonly nextCursor: string | null; readonly total: number; }
export interface GetEndpointOutput { readonly endpoint: EndpointSpec; readonly serviceId: string; }
export type IRequestSchema =
  | { readonly kind: "fields"; readonly fields: ReadonlyArray<unknown> }
  | { readonly kind: "body"; readonly body: unknown }
  | { readonly kind: "none" };
export interface GetSchemaOutput { readonly schema: IRequestSchema; }
export interface ListServicesOutput { readonly services: ReadonlyArray<IServiceSummary>; }
export interface DryRunOutput { readonly endpointCount: number; readonly frameworks: ReadonlyArray<string>; readonly warnings: ReadonlyArray<string>; readonly durationMs: number; }
export interface ExportOutput { readonly outputPath: string; readonly bytes: number; }
export type IHistoryEntry =
  | { readonly kind: "snapshot-ready"; readonly capturedAt: string; readonly sessionId: string }
  | { readonly kind: "snapshot-stale"; readonly capturedAt: string; readonly changedPaths: ReadonlyArray<string> };
export interface HistoryOutput { readonly entries: ReadonlyArray<IHistoryEntry>; readonly total: number; }
export interface WatchSubscription { readonly subscriptionId: string; readonly projectRoot: string; readonly onlyPaths: ReadonlyArray<string> | null; }
export interface WatchOutput { readonly subscription: WatchSubscription; }
export interface CancelOutput { readonly cancelled: number; }
export interface SettingsOutput { readonly applied: Readonly<Record<string, unknown>>; }
export interface ListProjectsOutput { readonly projects: ReadonlyArray<IProjectEntry>; }
export interface CloseOutput { readonly closed: number; }