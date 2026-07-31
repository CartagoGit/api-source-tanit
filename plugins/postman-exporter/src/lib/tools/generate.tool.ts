/**
 * Tool `postman_exporter_generate`.
 *
 * SOLID: S = orquesta generación + parseo. L = parseGenerateOutput. D = runBunScript.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
} from "@mcp-vertex/core/public";
import z from "zod";

import { GenerateInputSchema, type IGenerateOutput } from "../contract/postman-exporter.interface";
import {
  parseGenerateOutput,
  parseRequestCount,
  runBunScript,
} from "../helpers/runner.helper";

// Note: the `id` must be the short tool name (without any namespace
// prefix). The server's `qualifiedId` rule (`${corePrefix}_${ns}_${tool.id}`)
// adds the plugin namespace automatically; pre-prefixing here would
// produce a double namespace like `mcp-vertex_postman-exporter_postman_exporter_*`.

const OUTPUT = z
  .object({
    collectionPath: z.string(),
    environmentPaths: z.array(z.string()),
    requests: z.number().int().min(0),
    folders: z.number().int().min(0),
    variables: z.number().int().min(0),
    durationMs: z.number().int().min(0),
  })
  .strict();

export const buildGenerateToolRegistration = (
  workspaceRoot: string,
  defaultProjectRoot: string | undefined,
): IToolRegistration => ({
  id: `generate`,
  tags: ["postman", "generator", "effects"],
  summary:
    "Genera la colección Postman v2.1.0 desde las rutas de un proyecto Laravel host.",
  register: async (server) => {
    server.registerTool(
      `${NAMESPACE}_exporter_generate`,
      {
        description:
          "Genera la colección Postman v2.1.0 desde las rutas de un proyecto Laravel host. " +
          "Devuelve rutas de los archivos generados (colección + environments) y métricas.",
        inputSchema: GenerateInputSchema,
        outputSchema: OUTPUT,
      },
      async (args: z.infer<typeof GenerateInputSchema>) => {
        const projectRoot = args.projectRoot ?? defaultProjectRoot ?? workspaceRoot;
        const cliArgs = ["generate", "--project-root", projectRoot];
        if (args.outputDir) cliArgs.push("--output-dir", args.outputDir);
        if (args.envs && args.envs.length > 0) {
          cliArgs.push("--envs", args.envs.join(","));
        }
        if (args.openAfter) cliArgs.push("--open");
        const result = runBunScript(
          `${workspaceRoot}/scripts/cli.script.ts`,
          cliArgs,
          { cwd: workspaceRoot },
        );
        if (!result.ok) {
          return toolError(
            `generate falló (exit=${result.exitCode}): ${result.stderr || result.stdout || "sin detalle"}`,
            "Revisa que projectRoot apunte a un Laravel con artisan + routes + app.",
          );
        }
        const parsedOutput = parseGenerateOutput(result.stdout);
        const counts = parseRequestCount(result.stdout);
        const out: IGenerateOutput = {
          collectionPath: parsedOutput.collectionPath ?? "<no detectado>",
          environmentPaths: parsedOutput.environmentPaths,
          requests: counts?.requests ?? 0,
          folders: counts?.folders ?? 0,
          variables: 0,
          durationMs: result.durationMs,
        };
        return toolJson(out);
      },
    );
  },
});
