/**
 * Tool `tanit_summary`.
 *
 * Inspects a host project without generating artefacts. Returns:
 * detected framework, baseUrl, routes in code, resolved
 * FormRequests, mode (zero-config or with host config), and count
 * of bodies/queries auto-filled by the framework-agnostic heuristic.
 *
 * SOLID: S = read-only; it mutates nothing.
 * D = the call is delegated to `summarizeProject()` (same code the
 *     CLI's `scripts/summary.script.ts` uses). This removes the
 *     previous "hack" of shelling out to `generate --inspect` and
 *     parsing stdout with regex.
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
            "withoutFormRequest, bodiesAdded, queriesAdded, zeroConfig, configPath, manualEndpoints, " +
            "health: porcentajes de endpoints con validación, body, ejemplos y descripción }.",
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
            // Annotated on purpose: spreading a foreign object lets
            // anything through, and then `outputSchema` would describe
            // an output nobody checks. With the type in front, the
            // compiler demands that what is returned is what was
            // promised.
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
              // f00010 S2: documentation health, in percentages.
              // The output is **projected field by field** (never
              // spread): if the summary adds a new field and this
              // block is not updated, the guard in
              // `plugin.interface.ts` will not compile.
              health: {
                withValidationPercent: summary.health.withValidationPercent,
                withBodySchemaPercent: summary.health.withBodySchemaPercent,
                withExamplesPercent: summary.health.withExamplesPercent,
                withDescriptionPercent: summary.health.withDescriptionPercent,
              },
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
