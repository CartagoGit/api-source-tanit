/**
 * `zod-schemas.ts` — input/output schemas for the 14 Application API
 * handlers (f00016 S3).
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

import { z } from "zod";

/** Common: the identity of a project root (always absolute, never `..`). */
export const ProjectRootSchema = z
  .string()
  .min(1, "projectRoot must not be empty");

/** Common: the id of an open session (whatever `ProjectSession.id` returned). */
export const SessionIdSchema = z.string().min(1, "sessionId must not be empty");

/**
 * Caller side: where the request originated. Used by handlers that
 * want to format messages differently (`desktop` is verbose, `cli`
 * is terse, `browser` is human-readable). Optional; defaults to
 * `"cli"` when missing.
 */
export const CallerSchema = z.enum(["desktop", "browser", "cli"]);

/**
 * `open-project` — opens a session for a project root.
 *
 * `orchestrator` is a structural projection of the discovery
 * orchestrator: the dispatcher never instantiates one, only the
 * caller does, so the schema is the minimal "what you must pass"
 * and the dispatcher treats it as opaque (the application-api
 * shares the orchestrator between `openSession()` and the
 * handlers).
 */
export const OpenProjectInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  /** If true, subscribe to filesystem watch on the session. */
  watch: z.boolean().optional(),
  /** Re-scan debounce window in ms. Defaults to 500 in the session. */
  watchDebounceMs: z.number().int().positive().optional(),
  /** Override the collection basename. Passed to the pipeline. */
  collectionName: z.string().min(1).optional(),
});
export type OpenProjectInput = z.infer<typeof OpenProjectInputSchema>;

/**
 * `snapshot` — the current immutable snapshot of a project.
 */
export const SnapshotInputSchema = z.object({
  projectRoot: ProjectRootSchema,
});
export type SnapshotInput = z.infer<typeof SnapshotInputSchema>;

/**
 * `list-endpoints` — paginated list of the endpoints in a snapshot.
 *
 * `limit` is bounded so a hostile caller cannot ask for the whole
 * world in one shot. `cursor` is opaque: handlers treat it as a
 * base64-ish key, the consumer treats it as an opaque string.
 */
export const ListEndpointsInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  /** Optional filter on the HTTP method (UPPERCASE). */
  method: z.string().optional(),
  /** Optional substring match on the URI. */
  uriContains: z.string().optional(),
  limit: z.number().int().positive().max(1000).optional(),
  cursor: z.string().optional(),
});
export type ListEndpointsInput = z.infer<typeof ListEndpointsInputSchema>;

/**
 * `get-endpoint` — one endpoint, identified by `method + uri`.
 *
 * `endpointId` is the composite key a UI would render: it is
 * whatever the dispatcher decides; the wire shape stays a stable
 * pair of fields.
 */
export const GetEndpointInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  method: z.string().min(1),
  uri: z.string().min(1),
});
export type GetEndpointInput = z.infer<typeof GetEndpointInputSchema>;

/**
 * `get-schema` — the request schema for one endpoint.
 */
export const GetSchemaInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  method: z.string().min(1),
  uri: z.string().min(1),
});
export type GetSchemaInput = z.infer<typeof GetSchemaInputSchema>;

/**
 * `list-services` — every service the snapshot discovered.
 */
export const ListServicesInputSchema = z.object({
  projectRoot: ProjectRootSchema,
});
export type ListServicesInput = z.infer<typeof ListServicesInputSchema>;

/**
 * `dry-run` — re-run the pipeline without writing a collection to
 * disk. Returns the in-memory result the real export would have
 * produced.
 */
export const DryRunInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  /** Override the collection basename for this run only. */
  collectionName: z.string().min(1).optional(),
});
export type DryRunInput = z.infer<typeof DryRunInputSchema>;

/**
 * `export` — render the collection to a target on disk.
 *
 * `target` is a free-form string today; the dispatcher knows the
 * canonical set (`postman`, `openapi`, `har`, `insomnia`,
 * `bruno`, `curl`). Keeping it as `string` keeps the schema
 * forward-compatible with future targets without a contract bump.
 */
export const ExportInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  target: z.string().min(1),
  /** Optional override of the output file path. */
  outputPath: z.string().min(1).optional(),
});
export type ExportInput = z.infer<typeof ExportInputSchema>;

/**
 * `history` — the snapshot deltas recorded since the session opened.
 *
 * Today this is the union of `snapshot-ready` events the session
 * emitted while open. The future event-sourcing slice will replace
 * it with a log-backed feed.
 */
export const HistoryInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  /** Max events to return; defaults to 100. */
  limit: z.number().int().positive().max(1000).optional(),
});
export type HistoryInput = z.infer<typeof HistoryInputSchema>;

/**
 * `watch` — subscribe to live snapshot deltas.
 *
 * `subscriptionId` is what the caller passes back into `cancel()` to
 * stop receiving. The dispatcher is responsible for the underlying
 * bookkeeping; the schema is just the surface.
 */
export const WatchInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  /** Optional filter — only `snapshot-stale` events with these changed files. */
  onlyPaths: z.array(z.string().min(1)).optional(),
});
export type WatchInput = z.infer<typeof WatchInputSchema>;

/**
 * `cancel` — cancel a running scan or a watch subscription.
 */
export const CancelInputSchema = z.object({
  /** Cancel a scan by projectRoot (closes + re-opens the session). */
  projectRoot: ProjectRootSchema.optional(),
  /** Cancel a watch subscription by id. */
  subscriptionId: z.string().min(1).optional(),
}).refine(
  (v) => v.projectRoot !== undefined || v.subscriptionId !== undefined,
  { message: "cancel requires at least one of projectRoot or subscriptionId" },
);
export type CancelInput = z.infer<typeof CancelInputSchema>;

/**
 * `settings` — get/set per-session options.
 *
 * `patch` is `Partial<IProjectSessionOptions>`: each key is
 * optional, omitted keys are left alone, present keys overwrite.
 */
export const SettingsInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  patch: z
    .object({
      watch: z.boolean().optional(),
      watchDebounceMs: z.number().int().positive().optional(),
      collectionName: z.string().min(1).optional(),
    })
    .optional(),
});
export type SettingsInput = z.infer<typeof SettingsInputSchema>;

/**
 * `list-projects` — every open session.
 *
 * No `projectRoot` argument: the caller wants the global list.
 */
export const ListProjectsInputSchema = z.object({});
export type ListProjectsInput = z.infer<typeof ListProjectsInputSchema>;

/**
 * `close` — release one (or all) sessions.
 */
export const CloseInputSchema = z.object({
  projectRoot: ProjectRootSchema.optional(),
}).refine((v) => v.projectRoot !== undefined, {
  message: "close requires a projectRoot (use close-all for the global close)",
});
export type CloseInput = z.infer<typeof CloseInputSchema>;

/**
 * Output schemas — typed projections of the snapshots and results
 * the core layers produce.
 *
 * We do **not** mirror the entire `EndpointSpec` (it has 20+ fields
 * and the UI only renders a subset). The dispatcher passes the raw
 * value back through `unknown` so the bridge can serialize it
 * faithfully, but the application code that consumes the API gets
 * the trimmed shape.
 */
export const EndpointSummarySchema = z.object({
  method: z.string(),
  uri: z.string(),
  name: z.string(),
  serviceId: z.string().optional(),
});
export type IEndpointSummary = z.infer<typeof EndpointSummarySchema>;

export const ServiceSummarySchema = z.object({
  serviceId: z.string(),
  framework: z.string(),
  endpointCount: z.number().int().nonnegative(),
});
export type IServiceSummary = z.infer<typeof ServiceSummarySchema>;

export const SnapshotSummarySchema = z.object({
  sessionId: z.string(),
  projectRoot: z.string(),
  capturedAt: z.string(),
  frameworks: z.array(z.string()),
  endpointCount: z.number().int().nonnegative(),
  serviceCount: z.number().int().nonnegative(),
});
export type ISnapshotSummary = z.infer<typeof SnapshotSummarySchema>;

export const ProjectEntrySchema = z.object({
  projectRoot: z.string(),
  sessionId: z.string(),
  capturedAt: z.string(),
  endpointCount: z.number().int().nonnegative(),
  frameworks: z.array(z.string()),
});
export type IProjectEntry = z.infer<typeof ProjectEntrySchema>;