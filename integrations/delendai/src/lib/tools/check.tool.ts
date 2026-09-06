/**
 * Tool `tanit_check`.
 *
 * Answers "has my collection drifted from the code?", which is the
 * question an agent most wants to ask before touching anything — and
 * the one that could not be asked: the command existed in the CLI
 * from the start and the plugin did not expose it.
 *
 * It returns **the endpoints**, not the table the CLI prints. An
 * agent that parses text with regex breaks the day a column changes,
 * and that hack has already been paid for in this very plugin.
 *
 * `ok` and `inSync` deliberately say different things: `ok` means
 * "the check could run"; `inSync` is the result. A **detected**
 * drift is a check that worked, and returning it as a tool error
 * makes the agent retry instead of reading the list.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
  type IMcpPluginContext,
} from "@delendai/core/public";

import {
  CheckInputSchema,
  CheckOutputSchema,
  type ICheckOutput,
} from "../contracts/plugin.interface";
import { runCheck } from "../../../../../cli/commands/diff.script";
import { resolveProjectContext } from "../../../../../core/discovery/project-context.service";

const TOOL_ID = "check";

export function buildCheckToolRegistration(ctx: IMcpPluginContext): IToolRegistration {
  return {
    id: TOOL_ID,
    summary:
      "Comprueba si la colección Postman sigue al día con las rutas del código. " +
      "Devuelve qué endpoints faltan en la colección y cuáles sobran, con nombre " +
      "de operación cuando el protocolo lo necesita (GraphQL, tRPC).",
    tags: ["postman", "api", "check", "drift"],
    effects: [],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        {
          description:
            "¿La colección sigue sincronizada con el código? Devuelve `inSync` y las " +
            "dos listas de deriva: lo que falta en la colección (hay que regenerar) y " +
            "lo que sobra (se borró o renombró en el código).",
          inputSchema: CheckInputSchema,
          outputSchema: CheckOutputSchema,
        },
        async (input) => {
          const parsed = CheckInputSchema.safeParse(input);
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
          if (args.collectionPath) argv.push("--output", args.collectionPath);

          const started = Date.now();
          const context = resolveProjectContext({ projectRoot });
          const { report } = await runCheck(argv, context);

          if (!report) {
            return toolError(
              "No se pudo comparar: falta la colección o el proyecto no se reconoció.",
              "Ejecuta `generate` primero, o pasa `collectionPath` si está en otro sitio.",
            );
          }

          const out: ICheckOutput = {
            ok: true,
            inSync: report.inSync,
            routesInSource: report.routesInSource,
            requestsInCollection: report.requestsInCollection,
            missingInCollection: report.missingInCollection.map((e) => ({
              method: e.method,
              uri: e.uri,
              ...(e.name ? { name: e.name } : {}),
            })),
            missingInSource: report.missingInSource.map((e) => ({
              method: e.method,
              uri: e.uri,
              ...(e.name ? { name: e.name } : {}),
            })),
            durationMs: Date.now() - started,
          };
          return toolJson(out);
        },
      );
    },
  };
}
