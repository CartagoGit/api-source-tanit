/**
 * Tool `expostman_init`.
 *
 * Prepara un `config.constant.ts` válido dentro del proyecto anfitrión.
 *
 * ## Por qué merece ser un tool si el zero-config ya funciona
 *
 * Se midió: sobre `example-express`, generar con la config que escribe
 * `init` y generar sin ella dan **exactamente lo mismo** — 9 requests,
 * 3 carpetas, el mismo tamaño. O sea que `init` no hace falta para que
 * la herramienta funcione, y decir lo contrario sería vender humo.
 *
 * Hace falta para lo otro: **personalizar**. Zonas, nombres de carpeta,
 * descripciones por guard, variables propias. Y ahí el problema real es
 * que un agente que quiera dejar preparada esa personalización tendría
 * que inventarse la forma de `ProjectConfig` de memoria. Escribir un
 * fichero de configuración adivinando su esquema es exactamente el
 * fallo que este proyecto lleva toda la ronda persiguiendo.
 *
 * `init` lo escribe **desde el contrato real**, con los `// TODO` donde
 * toca, y devuelve las dos rutas para que alguien las abra.
 *
 * ## Escribe dentro del proyecto de quien llama
 *
 * De ahí `effects: ["write"]`: el host lo usa para decidir si un agente
 * puede invocarlo sin confirmación.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
  type IMcpPluginContext,
} from "@mcp-vertex/core/public";

import {
  InitInputSchema,
  InitOutputSchema,
  type IInitOutput,
} from "../contracts/plugin.interface";
import { runInit } from "../../../../../cli/commands/init.script";
import { resolveProjectContext } from "../../../../../core/discovery/project-context.service";

const TOOL_ID = "init";

export function buildInitToolRegistration(ctx: IMcpPluginContext): IToolRegistration {
  return {
    id: TOOL_ID,
    summary:
      "Escribe un `config.constant.ts` válido en el proyecto, con los valores " +
      "detectados y los TODO donde hay que personalizar. Para zonas, nombres " +
      "y variables propias: sin config el zero-config ya genera igual.",
    tags: ["postman", "api", "init", "scaffold"],
    effects: ["write"],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        {
          description:
            "Prepara la configuración del proyecto y devuelve dónde la ha " +
            "escrito. Evita tener que inventarse la forma de `ProjectConfig`: " +
            "el fichero sale del contrato real, con los TODO señalados.",
          inputSchema: InitInputSchema,
          outputSchema: InitOutputSchema,
        },
        async (input) => {
          const parsed = InitInputSchema.safeParse(input);
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
          if (args.name) argv.push("--name", args.name);
          if (args.outputDir) argv.push("--output", args.outputDir);

          const started = Date.now();
          const context = resolveProjectContext({
            projectRoot,
            ...(args.outputDir ? { outputDir: args.outputDir } : {}),
          });
          const outcome = await runInit(argv, context);

          if (outcome.error) {
            return toolError(outcome.error.reason, outcome.error.nextAction);
          }

          const out: IInitOutput = {
            ok: true,
            projectName: outcome.projectName,
            baseUrl: outcome.baseUrl,
            authGuards: [...outcome.authGuards],
            routeFiles: [...outcome.routeFiles],
            configPath: outcome.configPath,
            endpointsPath: outcome.endpointsPath,
            durationMs: Date.now() - started,
          };
          return toolJson(out);
        },
      );
    },
  };
}
