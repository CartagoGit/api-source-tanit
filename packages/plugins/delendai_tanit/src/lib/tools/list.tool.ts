/**
 * Tool `tanit_list`.
 *
 * The endpoints of the collection, **as data**. The CLI prints a
 * table grouped by zones for human reading; an agent that parses it
 * with regex breaks the day a column changes, and that hack has
 * already been paid for in this very plugin.
 *
 * It is read-only: it neither generates nor writes anything. Hence
 * `effects: []`.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
  type IMcpPluginContext,
} from "@delendai/core/public";

import {
  ListInputSchema,
  ListOutputSchema,
  type IListOutput,
} from "../contracts/plugin.interface";
import { runList } from "../../../../../cli/commands/list-endpoints.script";
import { resolveProjectContext } from "../../../../../core/discovery/project-context.service";

const TOOL_ID = "list";

export function buildListToolRegistration(ctx: IMcpPluginContext): IToolRegistration {
  return {
    id: TOOL_ID,
    summary:
      "Lista los endpoints de la colección generada, con método, URI, nombre y " +
      "carpeta. Solo lectura: no genera nada.",
    tags: ["postman", "api", "list"],
    effects: [],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        {
          description:
            "Los endpoints de la colección ya generada, en datos: método, URI, nombre " +
            "y carpeta. El nombre importa en GraphQL y tRPC, donde todas las " +
            "operaciones comparten método y URL.",
          inputSchema: ListInputSchema,
          outputSchema: ListOutputSchema,
        },
        async (input) => {
          const parsed = ListInputSchema.safeParse(input);
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
          const { code, endpoints } = await runList([], context);

          if (code !== 0) {
            return toolError(
              "No hay ninguna colección que listar.",
              "Ejecuta `generate` primero sobre ese proyecto.",
            );
          }

          const out: IListOutput = {
            ok: true,
            total: endpoints.length,
            endpoints: endpoints.map((e) => ({
              method: e.method,
              uri: e.uri,
              name: e.name,
              folder: e.folder,
            })),
          };
          return toolJson(out);
        },
      );
    },
  };
}
