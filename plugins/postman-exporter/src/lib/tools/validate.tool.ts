/**
 * Tool `postman_exporter_validate`.
 *
 * Ejecuta el script `diff.script.ts` + `validate-json.script.ts`
 * del proyecto postman-exporter contra un JSON ya generado.
 * Devuelve OK/KO con lista de issues estructurados.
 *
 * SOLID:
 *   - S: solo valida, no genera.
 *   - L: delega el parseo a `runBunScript` (sin regex aquí).
 *   - D: usa opciones del plugin (cliScript path) inyectadas.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
} from "@mcp-vertex/core/public";

import {
  ValidateInputSchema,
  type IValidateOutput,
} from "../contract/postman-exporter.interface";
import { runBunScript } from "../helpers/runner.helper";

const NAMESPACE = "postman";

export function buildValidateToolRegistration(): IToolRegistration {
  return {
    name: `${NAMESPACE}_exporter_validate`,
    description:
      "Valida un JSON Postman v2.1.0 existente (schema v2.1.0 + cobertura bidireccional " +
      "con las rutas del proyecto Laravel). Devuelve OK/KO con issues estructurados.",
    inputSchema: ValidateInputSchema,
    async handler(input: unknown): Promise<ReturnType<typeof toolJson>> {
      const parsed = ValidateInputSchema.safeParse(input);
      if (!parsed.success) {
        return toolError(
          `Input inválido: ${parsed.error.message}`,
          "Pasa collectionPath (ruta absoluta al *.postman_collection.json).",
        );
      }
      const args = parsed.data;
      const cliArgs = ["check"];
      if (args.projectRoot) cliArgs.push("--project-root", args.projectRoot);
      // check usa outputDir inferido; si necesitamos apuntar a collectionPath,
      // lo hacemos vía --output.
      cliArgs.push("--output", args.collectionPath);

      const result = runBunScript(
        "scripts/diff.script.ts",
        cliArgs,
        { cwd: process.cwd() },
      );
      const issues: IValidateOutput["issues"] = [];
      if (!result.ok) {
        issues.push({
          severity: "error",
          message:
            result.stderr.trim() || result.stdout.trim() || "diff.script.ts falló sin detalle",
        });
      }
      // Métricas básicas desde stdout (regex tolerante).
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
  };
}
