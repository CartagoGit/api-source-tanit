/**
 * Tool `tanit_init`.
 *
 * Prepares a valid `config.constant.ts` inside the host project.
 *
 * ## Why it deserves to be a tool if zero-config already works
 *
 * It was measured: on `example-express`, generating with the config
 * `init` writes and generating without it produce **exactly the
 * same** — 9 requests, 3 folders, the same size. So `init` is not
 * required for the tool to work, and saying otherwise would be
 * selling smoke.
 *
 * It is needed for the other thing: **customising**. Zones, folder
 * names, per-guard descriptions, custom variables. And there the
 * real problem is that an agent wanting to leave that customisation
 * ready would have to invent the shape of `ProjectConfig` from
 * memory. Writing a config file by guessing its schema is exactly
 * the failure this project has spent the whole round chasing.
 *
 * `init` writes it **from the real contract**, with the `// TODO`s
 * where they belong, and returns both paths so someone can open them.
 *
 * ## It writes inside the caller's project
 *
 * Hence `effects: ["write"]`: the host uses it to decide whether an
 * agent may invoke it without confirmation.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
  type IMcpPluginContext,
} from "@delendai/core/public";

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
