/**
 * Tool `export-to-postman_summary`.
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

import { SummaryInputSchema } from "../contracts/plugin.interface";
import { existsSync } from "node:fs";
import { summarizeWithAllFrameworks } from "../../../../frameworks/index";

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
          const projectRoot =
            args.projectRoot ?? defaultProjectRoot ?? workspaceRoot;
          if (!existsSync(projectRoot)) {
            return toolError(
              `projectRoot no existe: ${projectRoot}`,
              "Pasa projectRoot absoluto, o configura defaultProjectRoot.",
            );
          }

          try {
            const summary = await summarizeWithAllFrameworks(projectRoot);
            return toolJson({ ok: true, ...summary });
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
