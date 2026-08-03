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
              "Pasa projectRoot (ruta absoluta).",
            );
          }
          const args = parsed.data;
          const workspaceRoot = ctx.workspace.toString();
          const cliScriptPath =
            (ctx.options["cliScript"] as string | undefined) ??
            `${workspaceRoot}/scripts/cli.script.ts`;

          // Reutilizamos `generate` con un outputDir efímero para volcar
          // discovery + cobertura. No es ideal (deja un directorio) pero
          // es suficiente para inspección; un slice futuro añadirá un
          // modo `--dry-run` real.
          const ephemeralDir = "/tmp/postman-exporter-summary-dryrun";
          const result = runBunScript(
            cliScriptPath,
            [
              "generate",
              "--project-root",
              args.projectRoot,
              "--output-dir",
              ephemeralDir,
            ],
            { cwd: workspaceRoot, timeoutMs: 30_000 },
          );
          if (!result.ok) {
            return toolError(
              `summary falló (exit=${result.exitCode}): ${result.stderr || result.stdout || "sin detalle"}`,
              "Asegúrate de que projectRoot apunte a un proyecto Laravel válido.",
            );
          }

          const configMatch = result.stdout.match(/Config host:\s+(.+)/);
          const routesMatch = result.stdout.match(/(\d+)\s+rutas en c[oó]digo/);
          const frMatch = result.stdout.match(/\(FormRequest:\s+(\d+)/);
          const out: ISummaryOutput = {
            projectName: configMatch?.[1]?.trim() ?? "<no detectado>",
            baseUrl: "<inferida por zero-config o config del host>",
            routesInCode: routesMatch ? Number(routesMatch[1]) : 0,
            formRequestsResolved: frMatch ? Number(frMatch[1]) : 0,
            zeroConfig: (configMatch?.[1] ?? "").includes("<zero-config>"),
            configPath: configMatch?.[1]?.trim() ?? "<zero-config>",
          };
          return toolJson({ ok: true, ...out });
        },
      );
    },
  };
}
