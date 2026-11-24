import { toolError, toolJson, type IMcpPluginContext, type IToolRegistration } from "@delendai/core/public";

import { ClientProjectCandidatesInputSchema } from "../../../../../packages/contracts/constants/core/client-consumption.constant.js";
import { inspectClientProjectCandidates } from "../../../../../packages/core/discovery/client-usage.service";
import { defaultOrchestrator } from "../../../../../packages/frameworks/index";
import { ClientCandidatesOutputSchema } from "../contracts/client-usage.interface";
import { createContainedProjectResolver } from "../helpers/project-root.helper";

const TOOL_ID = "client_candidates";

/** Register read-only candidate discovery for explicitly selected workspaces. */
export function buildClientCandidatesToolRegistration(ctx: IMcpPluginContext): IToolRegistration {
  const summary = "Lista carpetas candidatas de frontend o servicios de backend para una raíz dentro del workspace.";

  return {
    id: TOOL_ID,
    summary,
    tags: ["api", "client", "discovery"],
    effects: [],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        { description: summary, inputSchema: ClientProjectCandidatesInputSchema, outputSchema: ClientCandidatesOutputSchema },
        async (input) => {
          const parsed = ClientProjectCandidatesInputSchema.safeParse(input);
          if (!parsed.success) return toolError(`Entrada inválida: ${parsed.error.message}`);

          try {
            const resolve = await createContainedProjectResolver(ctx);
            const root = await resolve(parsed.data.projectRoot, "projectRoot");
            return toolJson(await inspectClientProjectCandidates(root, parsed.data.role, defaultOrchestrator()));
          } catch (error) {
            return toolError(
              `No se pudieron listar los candidatos: ${error instanceof Error ? error.message : String(error)}`,
              "Comprueba la ruta y los permisos del proyecto dentro del workspace.",
            );
          }
        },
      );
    },
  };
}
