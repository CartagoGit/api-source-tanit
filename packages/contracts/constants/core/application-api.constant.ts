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
  /**
   * The filters the app's endpoint explorer offers.
   *
   * They were on the client before, filtering a list the app had
   * invented. A filter over invented data is decoration; a filter the
   * backend answers is a filter. They are here so both faces can ask
   * the same question of the same place.
   */
  service: z.string().optional(),
  transport: z.string().optional(),
  auth: z.string().optional(),
  validation: z.string().optional(),
  /** The framework that recognized the endpoint. */
  framework: z.string().optional(),
  /** A status, matched against the endpoint's responses. */
  responses: z.string().optional(),
  /** How sure the scanner is: `high`, `medium` or `low`. */
  confidence: z.string().optional(),
  /** A path fragment of the declaring file. */
  sourceFile: z.string().optional(),
  /** Free text over the method, the URI and the name. */
  search: z.string().optional(),
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
  /** The format to preview. `postman` when nobody says. */
  target: z.string().min(1).optional(),
  /** Where the files would go. */
  outputDirectory: z.string().min(1).optional(),
});
export const ExportInputSchema = z.object({
  projectRoot: ProjectRootSchema,
  target: z.string().min(1),
  /** The file to write. Its folder is the output directory. */
  outputPath: z.string().min(1).optional(),
  /** Where the files go. The project's `tanit` folder when nobody says. */
  outputDirectory: z.string().min(1).optional(),
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
  /**
   * The rest of what the snapshot knows about this endpoint.
   *
   * It used to be just method, URI and name — enough to count, not
   * enough to *show*. The app had to invent the rest (five thousand
   * invented endpoints, with an auth scheme and a confidence nobody
   * measured), because the summary could not answer. Now it can, and
   * every field here is read from the snapshot that really scanned
   * the project.
   */
  description: z.string().optional(),
  folder: z.string().optional(),
  transport: z.string().optional(),
  auth: z.string().optional(),
  validation: z.string().optional(),
  framework: z.string().optional(),
  confidence: z.string().optional(),
  /** The response statuses the inferrer found, as strings. */
  responses: z.array(z.string()).optional(),
  /** Where the route was declared, when the scanner knew. */
  sourceFile: z.string().optional(),
  /** 1-based line of the declaration, when the scanner knew. */
  line: z.number().int().nonnegative().optional(),
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