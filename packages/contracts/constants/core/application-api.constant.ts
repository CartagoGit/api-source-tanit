import { z } from "zod";

export const ProjectRootSchema = z.string().min(1, "projectRoot must not be empty");
export const SessionIdSchema = z.string().min(1, "sessionId must not be empty");
export const CallerSchema = z.enum(["desktop", "browser", "cli"]);

export const OpenProjectInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  watch: z.boolean().optional(),
  watchDebounceMs: z.number().int().positive().optional(),
  collectionName: z.string().min(1).optional(),
});
export const SnapshotInputSchema = z.object({ projectRoot: ProjectRootSchema });
export const ListEndpointsInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  method: z.string().optional(),
  uriContains: z.string().optional(),
  limit: z.number().int().positive().max(1000).optional(),
  cursor: z.string().optional(),
});
export const GetEndpointInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  method: z.string().min(1),
  uri: z.string().min(1),
});
export const GetSchemaInputSchema = GetEndpointInputSchema;
export const ListServicesInputSchema = SnapshotInputSchema;
export const DryRunInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  collectionName: z.string().min(1).optional(),
});
export const ExportInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  target: z.string().min(1),
  outputPath: z.string().min(1).optional(),
});
export const HistoryInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  limit: z.number().int().positive().max(1000).optional(),
});
export const WatchInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  onlyPaths: z.array(z.string().min(1)).optional(),
});
export const CancelInputSchema = z.object({
  projectRoot: ProjectRootSchema.optional(),
  subscriptionId: z.string().min(1).optional(),
}).refine(
  (value) => value.projectRoot !== undefined || value.subscriptionId !== undefined,
  { message: "cancel requires at least one of projectRoot or subscriptionId" },
);
export const SettingsInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  patch: z.object({
    watch: z.boolean().optional(),
    watchDebounceMs: z.number().int().positive().optional(),
    collectionName: z.string().min(1).optional(),
  }).optional(),
});
export const ListProjectsInputSchema = z.object({});
export const CloseInputSchema = z.object({
  projectRoot: ProjectRootSchema.optional(),
}).refine((value) => value.projectRoot !== undefined, {
  message: "close requires a projectRoot (use close-all for the global close)",
});

export const EndpointSummarySchema = z.object({
  method: z.string(),
  uri: z.string(),
  name: z.string(),
  serviceId: z.string().optional(),
});
export const ServiceSummarySchema = z.object({
  serviceId: z.string(),
  framework: z.string(),
  endpointCount: z.number().int().nonnegative(),
});
export const SnapshotSummarySchema = z.object({
  sessionId: z.string(),
  projectRoot: z.string(),
  capturedAt: z.string(),
  frameworks: z.array(z.string()),
  endpointCount: z.number().int().nonnegative(),
  serviceCount: z.number().int().nonnegative(),
});
export const ProjectEntrySchema = z.object({
  projectRoot: z.string(),
  sessionId: z.string(),
  capturedAt: z.string(),
  endpointCount: z.number().int().nonnegative(),
  frameworks: z.array(z.string()),
});

export const HANDLER_NAMES = [
  "open-project", "snapshot", "list-endpoints", "get-endpoint",
  "get-schema", "list-services", "dry-run", "export", "history",
  "watch", "cancel", "settings", "list-projects", "close",
] as const;