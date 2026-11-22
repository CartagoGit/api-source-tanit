import { z } from "zod";
import { ClientAnalysisInputSchema } from "../../../../../packages/contracts/constants/core/client-consumption.constant.js";
import type { IClientConsumptionResult } from "../../../../../packages/contracts/interfaces/core/client-consumption.interface";

export const ClientUsageInputSchema = ClientAnalysisInputSchema.extend({
  projectRoot: ClientAnalysisInputSchema.shape.projectRoot.optional().describe("Proyecto cliente dentro del workspace. Por defecto se usa el proyecto configurado."),
  backendRoot: ClientAnalysisInputSchema.shape.backendRoot.describe("Proyecto backend dentro del workspace para correlacionar operaciones."),
  aliases: ClientAnalysisInputSchema.shape.aliases.describe("Receptores HTTP, wrappers o SDK declarados explícitamente."),
});

const LocationSchema = z.strictObject({
  file: z.string(),
  line: z.int().positive(),
  column: z.int().nonnegative(),
  start: z.int().nonnegative().optional(),
  end: z.int().nonnegative().optional(),
});

const BackendOperationSchema = z.strictObject({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "ALL"]),
  uri: z.string(),
  name: z.string().optional(),
  serviceId: z.string().optional(),
  id: z.string().optional(),
  location: LocationSchema.optional(),
});

const UsageSchema = z.strictObject({
  method: z.string().optional(),
  url: z.string().optional(),
  path: z.string().optional(),
  host: z.string().optional(),
  location: LocationSchema,
  evidence: z.strictObject({
    recognizer: z.enum(["fetch", "axios", "configured-alias"]),
    callee: z.string(),
    staticUrl: z.enum(["literal", "expression"]).optional(),
  }),
  confidence: z.enum(["high", "medium", "low"]),
  unresolvedReason: z.enum([
    "shadowed-client",
    "unresolved-alias",
    "unsupported-call",
    "dynamic-url",
    "invalid-url",
    "relative-url",
    "dynamic-method",
    "unknown-options",
  ]).optional(),
  correlation: z.strictObject({
    status: z.enum(["matched", "missing", "ambiguous", "unknown"]),
    candidates: z.array(BackendOperationSchema),
  }).optional(),
});

/** MCP validation for the same result returned by the shared client analysis. */
export const ClientUsageOutputSchema = z.strictObject({
  usages: z.array(UsageSchema),
  diagnostics: z.array(z.strictObject({
    file: z.string(),
    reason: z.enum(["unsupported-template", "unsupported-script", "parse-failed"]),
  })),
  counts: z.strictObject({
    resolved: z.int().nonnegative(),
    unresolved: z.int().nonnegative(),
    matched: z.int().nonnegative(),
    missing: z.int().nonnegative(),
    ambiguous: z.int().nonnegative(),
  }),
  operationsWithoutConfirmedConsumer: z.array(BackendOperationSchema).optional(),
}) satisfies z.ZodType<IClientConsumptionResult>;
