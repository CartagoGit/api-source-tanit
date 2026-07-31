/**
 * Tool `postman_exporter_validate`.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
} from "@mcp-vertex/core/public";
import z from "zod";

import {
  ValidateInputSchema,
  type IValidateOutput,
} from "../contract/postman-exporter.interface";
import { runBunScript } from "../helpers/runner.helper";

// Note: the `id` must be the short tool name (without any namespace
// prefix). The server's `qualifiedId` rule (`${corePrefix}_${ns}_${tool.id}`)
// adds the plugin namespace automatically; pre-prefixing here would
// produce a double namespace like `mcp-vertex_postman-exporter_postman_exporter_*`.

const OUTPUT = z
  .object({
    ok: z.boolean(),
    routesInSource: z.number().int().min(0),
    requestsInCollection: z.number().int().min(0),
    issues: z.array(
      z.object({
        severity: z.enum(["error", "warning"]),
        message: z.string(),
      }),
    ),
    durationMs: z.number().int().min(0),
  })
  .strict();

export const buildValidateToolRegistration = (
  workspaceRoot: string,
): IToolRegistration => ({
  id: `validate`,
  tags: ["postman", "validator", "effects"],
  summary:
    "Valida un JSON Postman v2.1.0 existente con cobertura bidireccional.",
  register: async (server) => {
    server.registerTool(
      `${NAMESPACE}_exporter_validate`,
      {
        description:
          "Valida un JSON Postman v2.1.0 existente (schema v2.1.0 + cobertura " +
          "bidireccional con las rutas del proyecto Laravel). Devuelve OK/KO.",
        inputSchema: ValidateInputSchema,
        outputSchema: OUTPUT,
      },
      async (args: z.infer<typeof ValidateInputSchema>) => {
        const cliArgs = ["check"];
        if (args.projectRoot) cliArgs.push("--project-root", args.projectRoot);
        cliArgs.push("--output", args.collectionPath);
        const result = runBunScript(
          `${workspaceRoot}/scripts/diff.script.ts`,
          cliArgs,
          { cwd: workspaceRoot },
        );
        const issues: IValidateOutput["issues"] = [];
        if (!result.ok) {
          issues.push({
            severity: "error",
            message:
              result.stderr.trim() ||
              result.stdout.trim() ||
              "diff.script.ts falló sin detalle",
          });
        }
        const routesMatch = result.stdout.match(/Routes en source:\s+(\d+)/);
        const collMatch = result.stdout.match(/Requests en colección:\s+(\d+)/);
        const out: IValidateOutput = {
          ok: result.ok && issues.length === 0,
          routesInSource: routesMatch ? Number(routesMatch[1]) : 0,
          requestsInCollection: collMatch ? Number(collMatch[1]) : 0,
          issues,
          durationMs: result.durationMs,
        };
        return toolJson(out);
      },
    );
  },
});
