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
import { NAMESPACE } from "../contract/namespace";
import { runBunScript } from "../helpers/runner.helper";

// Note: the `id` is the short tool name (e.g. `validate`).
// `server.registerTool` is called with the fully qualified id
// `${NAMESPACE}_exporter_${id}` because the SDK exposes the tool
// to the client under the exact name passed to `registerTool` —
// the host's `qualifiedId` rule is for cross-plugin bookkeeping,
// not for the MCP surface.

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
        inputSchema: ValidateInputSchema.shape,
        outputSchema: OUTPUT.shape,
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
        const issues: Array<{ severity: "error" | "warning"; message: string }> = [];
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
