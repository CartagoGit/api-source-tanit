/**
 * Tool `tanit_validate`.
 *
 * Runs `diff.script.ts` + `validate-json.script.ts` from the tanit
 * project against an already-generated JSON. Returns OK/KO with a
 * structured issues list.
 *
 * SOLID:
 *   - S: only validates, it does not generate.
 *   - L: it delegates parsing to `runBunScript` (no regex here).
 *   - D: it uses the injected plugin options (cliScript path).
 *
 * Canonical `IToolRegistration` shape.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
  type IMcpPluginContext,
} from "@delendai/core/public";

import {
  ValidateInputSchema,
  ValidateOutputSchema,
  type IValidateOutput,
} from "../contracts/plugin.interface";
import { resolveCliScript } from "../contracts/cli-path.constant";
import { runBunScript } from "../helpers/runner.helper";

const TOOL_ID = "validate";

export function buildValidateToolRegistration(
  ctx: IMcpPluginContext,
): IToolRegistration {
  return {
    id: TOOL_ID,
    summary:
      "Valida un JSON Postman v2.1.0 existente (schema v2.1.0 + cobertura bidireccional " +
      "con las rutas del proyecto host). Devuelve OK/KO con issues estructurados.",
    tags: ["postman", "api", "validate", "spawn"],
    effects: ["spawn"],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        {
          description:
            "Valida un JSON Postman v2.1.0 existente (schema v2.1.0 + cobertura bidireccional " +
            "con las rutas del proyecto host). Devuelve OK/KO con issues estructurados.",
          inputSchema: ValidateInputSchema,
          outputSchema: ValidateOutputSchema,
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
          const workspaceRoot = ctx.workspace.root;
          const defaultProjectRoot = ctx.options["defaultProjectRoot"] as
            | string
            | undefined;
          const cliScriptPath = resolveCliScript(
            workspaceRoot,
            ctx.options["cliScript"] as string | undefined,
          );

          const cliArgs = ["check"];
          if (args.projectRoot) {
            cliArgs.push("--project-root", args.projectRoot);
          } else if (defaultProjectRoot) {
            cliArgs.push("--project-root", defaultProjectRoot);
          }
          cliArgs.push("--output", args.collectionPath);

          const result = runBunScript(cliScriptPath, cliArgs, {
            cwd: workspaceRoot,
            ctx: {
              cwd: workspaceRoot,
              bunBin: ctx.options["delendaiBunBin"] as string | undefined,
            },
          });
          // Mutable here and `readonly` in the output contract: the
          // earlier annotation said `readonly[]` and still pushed.
          const issues: Array<IValidateOutput["issues"][number]> = [];
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

          // `ok` and `valid` say different things, and before they
          // were the same field. `ok` means "the check could run";
          // `valid` means "the collection is up to date". A detected
          // drift **is** a validation that worked.
          //
          // It used to return `toolError` in that case, which marks
          // the response with `isError`: the agent asking "is my
          // collection up to date?" received a tool failure instead
          // of the answer "no, and these are the reasons". The
          // difference matters because on an error you retry or give
          // up, whereas on `valid: false` you read `issues` and act.
          const out: IValidateOutput = {
            ok: true,
            valid: result.ok && issues.length === 0,
            routesInSource: routesMatch ? Number(routesMatch[1]) : 0,
            requestsInCollection: collMatch ? Number(collMatch[1]) : 0,
            issues,
            durationMs: result.durationMs,
          };
          return toolJson(out);
        },
      );
    },
  };
}
