/**
 * Tool `postman-exporter_validate`.
 *
 * Ejecuta `diff.script.ts` + `validate-json.script.ts` del proyecto
 * postman-exporter contra un JSON ya generado. Devuelve OK/KO con
 * lista de issues estructurados.
 *
 * SOLID:
 *   - S: solo valida, no genera.
 *   - L: delega el parseo a `runBunScript` (sin regex aquí).
 *   - D: usa opciones del plugin (cliScript path) inyectadas.
 *
 * Forma canónica `IToolRegistration`.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
  type IMcpPluginContext,
} from "@mcp-vertex/core/public";

import {
  ValidateInputSchema,
  type IValidateOutput,
} from "../contract/postman-exporter.interface";
import { runBunScript } from "../helpers/runner.helper";

const TOOL_ID = "validate";

export function buildValidateToolRegistration(
  ctx: IMcpPluginContext,
): IToolRegistration {
  return {
    id: TOOL_ID,
    summary:
      "Valida un JSON Postman v2.1.0 existente (schema v2.1.0 + cobertura bidireccional " +
      "con las rutas del proyecto Laravel). Devuelve OK/KO con issues estructurados.",
    tags: ["postman", "laravel", "validate", "spawn"],
    effects: ["spawn"],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        {
          description:
            "Valida un JSON Postman v2.1.0 existente (schema v2.1.0 + cobertura bidireccional " +
            "con las rutas del proyecto Laravel). Devuelve OK/KO con issues estructurados.",
          inputSchema: ValidateInputSchema,
        },
        async (input) => {
          const parsed = ValidateInputSchema.safeParse(input);
          if (!parsed.success) {
            return toolError(
              `Input inválido: ${parsed.error.message}`,
              "Pasa collectionPath (ruta absoluta al *.postman_collection.json).",
            );
          }
          const args = parsed.data;
          const workspaceRoot = ctx.workspace.toString();
          const defaultProjectRoot = ctx.options["defaultProjectRoot"] as
            | string
            | undefined;
          const cliScriptPath =
            (ctx.options["cliScript"] as string | undefined) ??
            `${workspaceRoot}/scripts/cli.script.ts`;

          const cliArgs = ["check"];
          if (args.projectRoot) {
            cliArgs.push("--project-root", args.projectRoot);
          } else if (defaultProjectRoot) {
            cliArgs.push("--project-root", defaultProjectRoot);
          }
          cliArgs.push("--output", args.collectionPath);

          const result = runBunScript(cliScriptPath, cliArgs, {
            cwd: workspaceRoot,
          });
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
          if (!out.ok) {
            return toolError(
              `Validación KO: ${issues.map((i) => i.message).join("; ")}`,
              "Ejecuta `bun run generate` primero y revisa los issues reportados.",
            );
          }
          return toolJson({ ok: true, ...out });
        },
      );
    },
  };
}
