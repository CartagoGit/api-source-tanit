/**
 * Tool `tanit_push`.
 *
 * The only one that leaves the machine: it publishes the collection
 * to the requester's Postman workspace. Because `_postman_id` is
 * deterministic per project, invoking it twice **updates** instead
 * of duplicating.
 *
 * ## The secret does not come in here
 *
 * `PushInputSchema` does not declare `apiKey`, and that is
 * deliberate. The CLI reads the key from `POSTMAN_API_KEY`, which
 * is where the host can store it without it being passed through
 * the conversation. Declaring it as an input would invite the agent
 * to ask for it, receive it, and repeat it — and what a model repeats
 * ends up in a log nobody can retract.
 *
 * ## And it does not come out either
 *
 * The error arrives redacted from `runPush`: `{ reason, nextAction }`,
 * not the raw body of the Postman response. That body can include
 * the request that caused it, and with it the key's header.
 *
 * ## Why it declares `effects: ["network"]`
 *
 * Because the host uses it to decide whether an agent may invoke it
 * without confirmation. Uploading to a foreign workspace is one of
 * the few things in this project that cannot be undone by deleting
 * a file.
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
            // The reason already comes redacted from `runPush`: it
            // never carries the body of the Postman response.
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
