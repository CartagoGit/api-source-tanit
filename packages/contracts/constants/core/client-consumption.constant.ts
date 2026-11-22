import { z } from "zod";
import type { IClientAlias } from "../../interfaces/core/client-consumption.interface.js";

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
