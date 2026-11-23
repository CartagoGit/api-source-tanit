import { toolError, toolJson, type IMcpPluginContext, type IToolRegistration } from "@delendai/core/public";

import { ClientProjectLinksInputSchema } from "../../../../../packages/contracts/constants/core/client-consumption.constant.js";
import type { IClientProjectLinksInput } from "../../../../../packages/contracts/interfaces/core/client-consumption.interface";
import { analyzeClientProjectLinks } from "../../../../../packages/core/discovery/client-usage.service";
import { defaultOrchestrator } from "../../../../../packages/frameworks/index";
import { ClientLinksOutputSchema } from "../contracts/client-usage.interface";
import { createContainedProjectResolver } from "../helpers/project-root.helper";

const TOOL_ID = "client_links";

/** Register read-only analysis of explicitly selected frontend-to-backend links. */
export function buildClientLinksToolRegistration(ctx: IMcpPluginContext): IToolRegistration {
  const summary = "Compara las llamadas de los frontends con los servicios de backend vinculados explícitamente, sin generar artefactos.";

  return {
    id: TOOL_ID,
    summary,
    tags: ["api", "client", "discovery"],
    effects: [],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        { description: summary, inputSchema: ClientProjectLinksInputSchema, outputSchema: ClientLinksOutputSchema },
        async (input) => {
          const parsed = ClientProjectLinksInputSchema.safeParse(input);
          if (!parsed.success) return toolError(`Entrada inválida: ${parsed.error.message}`);

          try {
            const resolve = await createContainedProjectResolver(ctx);
            const frontends: IClientProjectLinksInput["frontends"][number][] = [];
            for (const [index, frontend] of parsed.data.frontends.entries()) {
              const root = await resolve(frontend.root, `frontends[${index}].root`);
              frontends.push({ ...frontend, root });
            }
            const links: IClientProjectLinksInput["links"][number][] = [];
            for (const [index, link] of parsed.data.links.entries()) {
              const frontendRoot = await resolve(link.frontendRoot, `links[${index}].frontendRoot`);
              const backendRoot = await resolve(link.backendRoot, `links[${index}].backendRoot`);
              links.push({ ...link, frontendRoot, backendRoot });
            }
            return toolJson(await analyzeClientProjectLinks({ ...parsed.data, frontends, links }, defaultOrchestrator()));
          } catch (error) {
            return toolError(
              `No se pudieron analizar los vínculos: ${error instanceof Error ? error.message : String(error)}`,
              "Comprueba las rutas y los permisos de los proyectos dentro del workspace y los IDs de servicio.",
            );
          }
        },
      );
    },
  };
}
