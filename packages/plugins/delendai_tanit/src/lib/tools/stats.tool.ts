/**
 * Tool `tanit_stats`.
 *
 * The shape of the collection in numbers: how many requests, by
 * method and by folder. It is what an agent looks at to decide
 * whether the collection is worth splitting, or to answer "how big
 * is this API?" without downloading the whole JSON.
 *
 * The CLI prints it as a table aligned with `padEnd`, and the
 * column width depends on the longest folder name — so it changes
 * between projects. Parsing that with regex is exactly the hack
 * this plugin already paid for once.
 *
 * Read-only: it neither generates nor writes anything. Hence
 * `effects: []`.
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
