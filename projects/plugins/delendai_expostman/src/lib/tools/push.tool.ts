/**
 * Tool `expostman_push`.
 *
 * El único que sale de la máquina: publica la colección en el workspace
 * de Postman de quien lo pide. Como el `_postman_id` es determinista por
 * proyecto, invocarlo dos veces **actualiza** en vez de duplicar.
 *
 * ## El secreto no entra por aquí
 *
 * `PushInputSchema` no declara `apiKey`, y es deliberado. La clave la
 * lee el CLI de `POSTMAN_API_KEY`, que es donde el host puede guardarla
 * sin que viaje por la conversación. Declararla como input sería una
 * invitación a que el agente la pida, la reciba y la repita — y lo que
 * un modelo repite acaba en un historial que nadie puede retirar.
 *
 * ## Y tampoco sale
 *
 * El error llega redactado desde `runPush`: `{ reason, nextAction }`, no
 * el cuerpo crudo de la respuesta de Postman. Ese cuerpo puede incluir
 * la petición que lo causó, y con ella la cabecera de la clave.
 *
 * ## Por qué declara `effects: ["network"]`
 *
 * Porque el host lo usa para decidir si un agente puede invocarlo sin
 * confirmación. Subir a un workspace ajeno es de las pocas cosas de este
 * proyecto que no se deshacen borrando un fichero.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
  type IMcpPluginContext,
} from "@delendai/core/public";

import {
  PushInputSchema,
  PushOutputSchema,
  type IPushOutput,
} from "../contracts/plugin.interface";
import { runPush } from "../../../../../cli/commands/push.script";
import { resolveProjectContext } from "../../../../../core/discovery/project-context.service";

const TOOL_ID = "push";

export function buildPushToolRegistration(ctx: IMcpPluginContext): IToolRegistration {
  return {
    id: TOOL_ID,
    summary:
      "Publica la colección en el workspace de Postman. Actualiza la que ya " +
      "exista en vez de duplicarla. La clave sale de POSTMAN_API_KEY: no se " +
      "pasa como argumento ni se devuelve.",
    tags: ["postman", "api", "push", "publish"],
    effects: ["network", "write"],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        {
          description:
            "Sube la colección generada a Postman y devuelve qué se creó o " +
            "actualizó, con su UID. Necesita POSTMAN_API_KEY en el entorno; la " +
            "clave nunca se acepta como argumento ni aparece en la respuesta.",
          inputSchema: PushInputSchema,
          outputSchema: PushOutputSchema,
        },
        async (input) => {
          const parsed = PushInputSchema.safeParse(input);
          if (!parsed.success) {
            return toolError(
              `Input inválido: ${parsed.error.message}`,
              "Pasa projectRoot (ruta absoluta) o configura defaultProjectRoot.",
            );
          }
          const args = parsed.data;
          const workspaceRoot = ctx.workspace.root;
          const defaultProjectRoot = ctx.options["defaultProjectRoot"] as
            | string
            | undefined;
          const projectRoot = args.projectRoot ?? defaultProjectRoot ?? workspaceRoot;

          const { existsSync } = await import("node:fs");
          if (!existsSync(projectRoot)) {
            return toolError(
              `projectRoot no existe: ${projectRoot}`,
              `Pasa projectRoot absoluto. Workspace actual: ${workspaceRoot}.`,
            );
          }

          const argv: string[] = [];
          if (args.workspaceId) argv.push("--workspace", args.workspaceId);
          if (args.framework) argv.push("--framework", args.framework);
          if (args.withEnvironments === false) argv.push("--no-environments");

          const started = Date.now();
          const context = resolveProjectContext({ projectRoot });
          const outcome = await runPush(argv, context);

          if (outcome.error) {
            // El motivo ya viene redactado de `runPush`: nunca trae el
            // cuerpo de la respuesta de Postman.
            return toolError(outcome.error.reason, outcome.error.nextAction);
          }

          const out: IPushOutput = {
            ok: true,
            pushed: outcome.collection !== null,
            user: outcome.user,
            framework: outcome.framework,
            requests: outcome.requests,
            collection: outcome.collection,
            environments: [...outcome.environments],
            durationMs: Date.now() - started,
          };
          return toolJson(out);
        },
      );
    },
  };
}
