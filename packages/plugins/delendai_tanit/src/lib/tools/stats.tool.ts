/**
 * Tool `tanit_stats`.
 *
 * La forma de la colección en números: cuántas requests, por método y por
 * carpeta. Es lo que un agente mira para decidir si merece la pena
 * trocear la colección, o para contestar «¿qué tamaño tiene esta API?»
 * sin descargarse el JSON entero.
 *
 * El CLI lo imprime como tabla alineada con `padEnd`, y el ancho de
 * columna depende del nombre de carpeta más largo — o sea que cambia
 * entre proyectos. Parsear eso con regex es exactamente el hack que este
 * plugin ya pagó una vez.
 *
 * Solo lectura: no genera ni escribe nada. De ahí `effects: []`.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
  type IMcpPluginContext,
} from "@delendai/core/public";

import {
  StatsInputSchema,
  StatsOutputSchema,
  type IStatsOutput,
} from "../contracts/plugin.interface";
import { runStats } from "../../../../../cli/commands/stats.script";
import { resolveProjectContext } from "../../../../../core/discovery/project-context.service";

const TOOL_ID = "stats";

export function buildStatsToolRegistration(ctx: IMcpPluginContext): IToolRegistration {
  return {
    id: TOOL_ID,
    summary:
      "Estadísticas de la colección generada: total de requests, desglose por " +
      "método HTTP y por carpeta. Solo lectura: no genera nada.",
    tags: ["postman", "api", "stats"],
    effects: [],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        {
          description:
            "El tamaño y la forma de la colección ya generada, en datos: total, " +
            "por método HTTP y por carpeta dentro de cada zona. Para dimensionar " +
            "una API sin leerse el JSON entero.",
          inputSchema: StatsInputSchema,
          outputSchema: StatsOutputSchema,
        },
        async (input) => {
          const parsed = StatsInputSchema.safeParse(input);
          if (!parsed.success) {
            return toolError(
              `Input inválido: ${parsed.error.message}`,
              "Pasa projectRoot (ruta absoluta) o configura defaultProjectRoot.",
            );
          }
          const workspaceRoot = ctx.workspace.root;
          const defaultProjectRoot = ctx.options["defaultProjectRoot"] as
            | string
            | undefined;
          const projectRoot =
            parsed.data.projectRoot ?? defaultProjectRoot ?? workspaceRoot;

          const { existsSync } = await import("node:fs");
          if (!existsSync(projectRoot)) {
            return toolError(
              `projectRoot no existe: ${projectRoot}`,
              `Pasa projectRoot absoluto. Workspace actual: ${workspaceRoot}.`,
            );
          }

          const context = resolveProjectContext({ projectRoot });
          const outcome = await runStats([], context);

          if (outcome.code !== 0) {
            return toolError(
              "No hay ninguna colección de la que sacar estadísticas.",
              "Ejecuta `generate` primero sobre ese proyecto.",
            );
          }

          const out: IStatsOutput = {
            ok: true,
            total: outcome.total,
            byMethod: outcome.byMethod.map((m) => ({
              method: m.method,
              count: m.count,
            })),
            zones: outcome.zones.map((z) => ({
              zone: z.zone,
              total: z.total,
              byFolder: z.byFolder.map((f) => ({
                folder: f.folder,
                count: f.count,
              })),
            })),
          };
          return toolJson(out);
        },
      );
    },
  };
}
