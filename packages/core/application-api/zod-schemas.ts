/**
 * `zod-schemas.ts` — input/output schemas for the Application API
 * handlers.
 *
 * One input schema per handler, plus the success-output schema. The
 * dispatcher validates `input` against the input schema, dispatches,
 * and validates the returned value against the output schema —
 * catching handler bugs before they reach a bridge.
 *
 * Schemas are deliberately small: each handler's input is what the
 * bridge side of a real consumer (CLI / Web UI / Tauri sidecar)
 * passes. Output schemas describe the **success** payload; failures
 * are the `IApiError` envelope (see `./error.ts`) and never use
 * these.
 *
 * Why zod here and not `valibot` / a hand-rolled parser: the project
 * already pins `zod: ^4.4.3` in `integrations/delendai/package.json`,
 * and the universal bootstrap §3.3 requires zod 4 for plugin-side
 * validation. Pinning the same major keeps the plugin and the API
 * on the same dial — `zod-to-json-schema` (slice acceptance) works
 * against the same types.
 */

export {
  BrowseInputSchema,
  CallerSchema,
  CancelInputSchema,
  CheckInputSchema,
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
  ProjectRootSchema,
  PushInputSchema,
  ServiceSummarySchema,
  SessionIdSchema,
  SettingsInputSchema,
  SnapshotInputSchema,
  SnapshotSummarySchema,
  StatsInputSchema,
  SyncInputSchema,
  ValidateInputSchema,
  WatchInputSchema,
} from "../../contracts/constants/core/application-api.constant.js";
export type {
  BrowseInput,
  CancelInput,
  CheckInput,
  CloseInput,
  DryRunInput,
  ExportInput,
  GetEndpointInput,
  GetSchemaInput,
  HistoryInput,
  IEndpointSummary,
  IProjectEntry,
  IServiceSummary,
  ISnapshotSummary,
  ListEndpointsInput,
  ListProjectsInput,
  ListServicesInput,
  OpenProjectInput,
  PushInput,
  SettingsInput,
  SnapshotInput,
  StatsInput,
  SyncInput,
  ValidateInput,
  WatchInput,
} from "../../contracts/interfaces/core/application-api.interface.js";
