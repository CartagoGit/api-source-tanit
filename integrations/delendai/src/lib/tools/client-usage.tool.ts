import {
  toolError,
  toolJson,
  type IMcpPluginContext,
  type IToolRegistration,
} from "@delendai/core/public";

import type { IClientConsumptionResult } from "../../../../../packages/contracts/interfaces/core/client-consumption.interface";
import { analyzeClientProjects } from "../../../../../packages/core/discovery/client-usage.service";
import { defaultOrchestrator } from "../../../../../packages/frameworks/index";
import { ClientUsageInputSchema, ClientUsageOutputSchema } from "../contracts/client-usage.interface";
import { createContainedProjectResolver, resolvePluginProjectRoot } from "../helpers/project-root.helper";

const TOOL_ID = "client_usage";

/** Register read-only static API consumption discovery and optional backend correlation. */
export function buildClientUsageToolRegistration(ctx: IMcpPluginContext): IToolRegistration {
  const summary = "Detecta el consumo de APIs en código cliente y lo correlaciona con un backend opcional, sin generar artefactos.";
  return {
    id: TOOL_ID,
    summary,
    tags: ["api", "client", "discovery"],
    effects: [],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        {
          description: summary,
          inputSchema: ClientUsageInputSchema,
          outputSchema: ClientUsageOutputSchema,
        },
        async (input) => {
          const parsed = ClientUsageInputSchema.safeParse(input);
          if (!parsed.success) {
            return toolError(`Input inválido: ${parsed.error.message}`);
          }

          try {
            const resolveRoot = await createContainedProjectResolver(ctx);
            const projectRoot = await resolveRoot(resolvePluginProjectRoot(ctx, parsed.data.projectRoot), "projectRoot");
            const backendRoot = parsed.data.backendRoot === undefined
              ? undefined
              : await resolveRoot(parsed.data.backendRoot, "backendRoot");

            const out: IClientConsumptionResult = await analyzeClientProjects({
              projectRoot,
              backendRoot,
              aliases: parsed.data.aliases,
            }, defaultOrchestrator());
            return toolJson(out);
          } catch (error) {
            return toolError(
              error instanceof Error ? error.message : String(error),
              "Comprueba las rutas y los permisos de los proyectos dentro del workspace.",
            );
          }
        },
      );
    },
  };
}
