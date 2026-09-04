/**
 * Tool `expostman_validate`.
 *
 * Ejecuta `diff.script.ts` + `validate-json.script.ts` del proyecto
 * export-to-postman contra un JSON ya generado. Devuelve OK/KO con
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
          // Mutable aquí y `readonly` en el contrato de salida: la anotación
          // anterior decía `readonly[]` y aun así hacía push.
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

          // `ok` y `valid` dicen cosas distintas, y antes eran el mismo
          // campo. `ok` es "la comprobación se pudo hacer"; `valid` es
          // "la colección está al día". Una colección desincronizada
          // detectada **es** una validación que ha funcionado.
          //
          // Devolvía `toolError` en ese caso, y eso marca la respuesta
          // con `isError`: el agente que pregunta "¿está al día mi
          // colección?" recibía un fallo de herramienta en vez de la
          // respuesta "no, y estos son los motivos". La diferencia
          // importa porque ante un error se reintenta o se abandona,
          // mientras que ante `valid: false` se lee `issues` y se actúa.
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
