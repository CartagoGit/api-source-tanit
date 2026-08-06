/**
 * Tool `postman-exporter_generate`.
 *
 * Ejecuta el script `generate.script.ts` del proyecto postman-exporter
 * contra el proyecto host que se le indique, devolviendo las rutas de los
 * artefactos generados y métricas básicas.
 *
 * SOLID:
 *   - S: solo orquesta la generación + parseo de output.
 *   - O: se puede extender (más flags) sin tocar el contrato.
 *   - L: lee el informe JSON del CLI, nunca su texto para personas.
 *   - D: depende de `runBunScript` (abstracción), no de Bun directo.
 *
 * Forma canónica `IToolRegistration`: el `id` es estable dentro del
 * plugin (`postman-exporter_generate`); el core lo cualifica con el
 * `namespacePrefix` del host. La MCP tool name registrada en el SDK
 * se construye en `register(server)` con el mismo prefijo.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
  type IMcpPluginContext,
} from "@mcp-vertex/core/public";

import {
  GenerateInputSchema,
  type IGenerateOutput,
} from "../contract/postman-exporter.interface";
import {
  readGenerateReport,
  runBunScript,
} from "../helpers/runner.helper";

/** Id estable del tool dentro del namespace del plugin. */
const TOOL_ID = "generate";

export function buildGenerateToolRegistration(
  ctx: IMcpPluginContext,
): IToolRegistration {
  return {
    id: TOOL_ID,
    summary:
      "Genera la colección Postman v2.1.0 desde las rutas del proyecto host. " +
      "Devuelve rutas de los archivos generados (colección + environments) y métricas.",
    tags: ["postman", "api", "generate", "spawn"],
    effects: ["spawn", "write"],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        {
          description:
            "Genera la colección Postman v2.1.0 desde las rutas del proyecto host. " +
            "Devuelve rutas de los archivos generados (colección + environments) y métricas.",
          inputSchema: GenerateInputSchema,
        },
        async (input) => {
          const parsed = GenerateInputSchema.safeParse(input);
          if (!parsed.success) {
            return toolError(
              `Input inválido: ${parsed.error.message}`,
              "Pasa projectRoot (ruta absoluta) o configura defaultProjectRoot " +
                "en mcp-vertex.config.json bajo plugins.postman-exporter.options.",
            );
          }
          const args = parsed.data;

          // Resolución del projectRoot con fallback documentado:
          //   args.projectRoot ?? ctx.options.defaultProjectRoot ?? ctx.workspace
          // Validamos que el resultado apunte a un directorio existente.
          const workspaceRoot = ctx.workspace.root;
          const defaultProjectRoot = ctx.options["defaultProjectRoot"] as
            | string
            | undefined;
          const projectRoot =
            args.projectRoot ?? defaultProjectRoot ?? workspaceRoot;
          const { existsSync } = await import("node:fs");
          if (!existsSync(projectRoot)) {
            return toolError(
              `projectRoot no existe: ${projectRoot}`,
              "Pasa projectRoot absoluto, o configura defaultProjectRoot en " +
                "mcp-vertex.config.json. Workspace actual: ${workspaceRoot}.",
            );
          }

          const cliArgs = ["generate", "--project-root", projectRoot, "--json"];
          if (args.outputDir) cliArgs.push("--output-dir", args.outputDir);
          if (args.envs && args.envs.length > 0) {
            cliArgs.push("--envs", args.envs.join(","));
          }
          if (args.openAfter) cliArgs.push("--open");

          const cliScriptPath =
            (ctx.options["cliScript"] as string | undefined) ??
            `${workspaceRoot}/scripts/cli.script.ts`;

          const result = runBunScript(cliScriptPath, cliArgs, {
            cwd: workspaceRoot,
          });
          if (!result.ok) {
            return toolError(
              `generate falló (exit=${result.exitCode}): ${result.stderr || result.stdout || "sin detalle"}`,
              "Revisa que projectRoot apunte a un proyecto de API de alguno de los\n" +
                "frameworks soportados (ver docs/FRAMEWORKS.md).",
            );
          }
          const parsedReport = readGenerateReport(result.stdout);
          if (!parsedReport.ok) {
            return toolError(
              `generate terminó bien pero no se pudo leer su informe: ${parsedReport.detail}`,
              "El CLI y el plugin tienen que hablar el mismo contrato " +
                "(`contract/generate-report.interface.ts`). Comprueba que ambos " +
                "estén a la misma versión.",
            );
          }
          const report = parsedReport.report;

          const out: IGenerateOutput = {
            framework: report.framework,
            collectionPath: report.collectionPath,
            collectionId: report.collectionId,
            environmentPaths: report.environmentPaths,
            requests: report.requests,
            folders: report.folders,
            auth: report.auth,
            durationMs: result.durationMs,
          };
          return toolJson({ ok: true, ...out });
        },
      );
    },
  };
}
