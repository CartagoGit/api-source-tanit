/**
 * Tool `expostman_check`.
 *
 * Responde «¿se ha desincronizado mi colección del código?», que es la
 * pregunta que un agente más quiere hacer antes de tocar nada — y la
 * que no se podía hacer: el comando existía en el CLI desde el
 * principio y el plugin no lo exponía.
 *
 * Devuelve **los endpoints**, no la tabla que imprime el CLI. Un agente
 * que parsee texto con regex se rompe el día que cambie una columna, y
 * ese hack ya se pagó antes en este mismo plugin.
 *
 * `ok` y `inSync` dicen cosas distintas a propósito: `ok` es «la
 * comprobación se pudo hacer», `inSync` es el resultado. Una colección
 * desincronizada **detectada** es una comprobación que ha funcionado, y
 * devolverla como error de herramienta hace que el agente reintente en
 * vez de leer la lista.
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
