/**
 * Tool `expostman_summary`.
 *
 * Inspecciona un proyecto host sin generar artefactos. Devuelve:
 * framework detectado, baseUrl, rutas en código, FormRequests
 * resueltos, modo (zero-config o con config del host), y conteo
 * de bodies/queries auto-rellenados por la heurística agnóstica.
 *
 * SOLID: S = solo lectura; no muta nada.
 * D = la llamada se delega a `summarizeProject()` (mismo código
 *     que usa el CLI `scripts/summary.script.ts`). Esto elimina
 *     el "hack" previo de shells out a `generate --inspect` y
 *     parsear stdout con regex.
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
  SummaryInputSchema,
  SummaryOutputSchema,
  type ISummaryOutput,
} from "../contracts/plugin.interface";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { summarizeWithAllFrameworks } from "../../../../../frameworks/index";

const TOOL_ID = "summary";

export function buildSummaryToolRegistration(
  ctx: IMcpPluginContext,
): IToolRegistration {
  return {
    id: TOOL_ID,
    summary:
      "Inspecciona un proyecto host (Laravel, OpenAPI, Express, FastAPI, NestJS, Django, etc.) sin generar artefactos. " +
      "Devuelve framework, baseUrl, rutas en código, FormRequests, bodies/queries auto-inferidos, modo.",
    tags: ["postman", "api", "summary", "discovery"],
    effects: [],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        {
          description:
            "Inspecciona un proyecto host sin escribir archivos. " +
            "Devuelve { framework, projectName, baseUrl, routesInCode, withFormRequest, " +
            "withoutFormRequest, bodiesAdded, queriesAdded, zeroConfig, configPath, manualEndpoints }.",
          inputSchema: SummaryInputSchema,
          outputSchema: SummaryOutputSchema,
        },
        async (input) => {
          const parsed = SummaryInputSchema.safeParse(input);
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
          const requestedProjectRoot =
            args.projectRoot ?? defaultProjectRoot ?? workspaceRoot;
          const projectRoot = isAbsolute(requestedProjectRoot)
            ? resolve(requestedProjectRoot)
            : resolve(workspaceRoot, requestedProjectRoot);
          if (!existsSync(projectRoot)) {
            return toolError(
              `projectRoot no existe: ${projectRoot}`,
              "Pasa projectRoot absoluto, o configura defaultProjectRoot.",
            );
          }

          try {
            const summary = await summarizeWithAllFrameworks(projectRoot);
            // Anotado a propósito: el spread de un objeto ajeno pasa
            // cualquier cosa, y entonces el `outputSchema` describiría
            // una salida que nadie comprueba. Con el tipo delante, el
            // compilador exige que lo que se devuelve sea lo que se
            // prometió.
            const out: ISummaryOutput = {
              ok: true,
              framework: summary.framework,
              frameworks: [...summary.frameworks],
              projectName: summary.projectName,
              baseUrl: summary.baseUrl,
              routesInCode: summary.routesInCode,
              withFormRequest: summary.withFormRequest,
              withoutFormRequest: summary.withoutFormRequest,
              bodiesAdded: summary.bodiesAdded,
              queriesAdded: summary.queriesAdded,
              evidence: [...summary.evidence],
              zeroConfig: summary.zeroConfig,
              configPath: summary.configPath,
              manualEndpoints: summary.manualEndpoints,
              inferredVariables: summary.inferredVariables,
              auth: summary.auth ? { loginEndpoint: summary.auth.loginEndpoint } : null,
              warnings: [...summary.warnings],
            };
            return toolJson(out);
          } catch (err) {
            return toolError(
              `summary falló: ${err instanceof Error ? err.message : String(err)}`,
              "Comprueba que projectRoot apunte a un proyecto válido y que el directorio sea legible.",
            );
          }
        },
      );
    },
  };
}
