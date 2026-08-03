/**
 * Tool `postman-exporter_summary`.
 *
 * Inspecciona un proyecto Laravel host sin generar artefactos.
 * Devuelve: nombre detectado, baseUrl, rutas en código, FormRequests
 * resueltos, modo (zero-config o con config del host).
 *
 * SOLID: S = solo lectura; no muta nada.
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
  type ISummaryOutput,
} from "../contract/postman-exporter.interface";
import { runBunScript } from "../helpers/runner.helper";

const TOOL_ID = "summary";

export function buildSummaryToolRegistration(
  ctx: IMcpPluginContext,
): IToolRegistration {
  return {
    id: TOOL_ID,
    summary:
      "Inspecciona un proyecto Laravel host sin generar artefactos. " +
      "Devuelve nombre detectado, baseUrl, rutas en código, FormRequests resueltos y modo.",
    tags: ["postman", "laravel", "summary", "spawn"],
    effects: ["spawn"],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        {
          description:
            "Inspecciona un proyecto Laravel host sin generar artefactos. Devuelve " +
            "nombre detectado, baseUrl, rutas en código, FormRequests resueltos y modo.",
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
          const workspaceRoot = ctx.workspace.toString();
          const defaultProjectRoot = ctx.options["defaultProjectRoot"] as
            | string
            | undefined;
          const projectRoot =
            args.projectRoot ?? defaultProjectRoot ?? workspaceRoot;
          const { existsSync } = await import("node:fs");
          if (!existsSync(projectRoot)) {
            return toolError(
              `projectRoot no existe: ${projectRoot}`,
              "Pasa projectRoot absoluto, o configura defaultProjectRoot.",
            );
          }
          const cliScriptPath =
            (ctx.options["cliScript"] as string | undefined) ??
            `${workspaceRoot}/scripts/cli.script.ts`;

          // Reutilizamos `generate --inspect` para volcar discovery sin
          // escribir archivos. Si el CLI no tiene --inspect, fallback a
          // un directorio efímero (legacy).
          const result = runBunScript(
            cliScriptPath,
            [
              "generate",
              "--project-root",
              projectRoot,
              "--inspect",
            ],
            { cwd: workspaceRoot, timeoutMs: 30_000 },
          );
          if (!result.ok) {
            return toolError(
              `summary falló (exit=${result.exitCode}): ${result.stderr || result.stdout || "sin detalle"}`,
              "Asegúrate de que projectRoot apunte a un proyecto válido y de que el CLI soporte --inspect.",
            );
          }

          const frameworkMatch = result.stdout.match(/Framework:\s+(\S+)/);
          const projectNameMatch = result.stdout.match(/ProjectName:\s+(\S+)/);
          const routesMatch = result.stdout.match(/Rutas:\s+(\d+)/);
          const frMatch = result.stdout.match(/Con FR:\s+(\d+)/);
          const baseUrlMatch = result.stdout.match(/BaseUrl:\s+(\S+)/);
          const framework = frameworkMatch?.[1]?.trim() ?? "legacy";
          const projectName = projectNameMatch?.[1]?.trim() ?? "<no detectado>";
          const out: ISummaryOutput = {
            projectName,
            baseUrl: baseUrlMatch?.[1]?.trim() ?? "<inferida por zero-config>",
            routesInCode: routesMatch ? Number(routesMatch[1]) : 0,
            formRequestsResolved: frMatch ? Number(frMatch[1]) : 0,
            zeroConfig: framework === "legacy" && projectName === "<no detectado>",
            configPath: projectName,
          };
          return toolJson({ ok: true, ...out });
        },
      );
    },
  };
}
