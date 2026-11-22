import { z } from "zod";
import type { ClientProjectRole, IClientAlias, IClientProjectLinksInput } from "../../interfaces/core/client-consumption.interface.js";

const ClientAliasSchema = z.strictObject({
  receiver: z.string().trim().min(1),
  source: z.string().min(1).optional(),
  kind: z.enum(["http", "unsupported"]).optional(),
}) satisfies z.ZodType<IClientAlias>;

export const ClientAnalysisInputSchema = z.strictObject({
  projectRoot: z.string().min(1),
  backendRoot: z.string().min(1).optional(),
  aliases: z.array(ClientAliasSchema).optional(),
});

const ClientProjectRoleSchema = z.enum(["frontend", "backend"]) satisfies z.ZodType<ClientProjectRole>;

export const ClientProjectCandidatesInputSchema = z.strictObject({
  projectRoot: ClientAnalysisInputSchema.shape.projectRoot,
  role: ClientProjectRoleSchema,
});

export const ClientProjectLinksInputSchema = z.strictObject({
  frontends: z.array(z.strictObject({
    root: ClientAnalysisInputSchema.shape.projectRoot,
    aliases: ClientAnalysisInputSchema.shape.aliases,
  })),
  links: z.array(z.strictObject({
    frontendRoot: ClientAnalysisInputSchema.shape.projectRoot,
    backendRoot: ClientAnalysisInputSchema.shape.projectRoot,
    serviceId: z.string().min(1),
    host: z.string().min(1).optional(),
  })),
}) satisfies z.ZodType<IClientProjectLinksInput>;
