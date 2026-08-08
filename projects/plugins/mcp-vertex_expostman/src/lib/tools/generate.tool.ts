/**
 * Tool `expostman_generate`.
 *
 * Ejecuta el script `generate.script.ts` del proyecto export-to-postman
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
 * plugin (`expostman_generate`); el core lo cualifica con el
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
  GenerateOutputSchema,
  type IGenerateOutput,
} from "../contracts/plugin.interface";
import { resolveCliScript } from "../contracts/cli-path.constant";
import { SUPPORTED_FRAMEWORKS } from "../../../../../frameworks/index";
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
      "Devuelve rutas de los archivos generados (colección + environments) y métricas. " +
      "Si la autodetección no reconoce el proyecto, se puede reintentar pasando " +
      "`framework` con el id que indique la persona. Con `formats` se piden " +
      "además OpenAPI, Insomnia, Bruno, HAR o cURL.",
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
          outputSchema: GenerateOutputSchema,
        },
        async (input) => {
          const parsed = GenerateInputSchema.safeParse(input);
          if (!parsed.success) {
            return toolError(
              `Input inválido: ${parsed.error.message}`,
              "Pasa projectRoot (ruta absoluta) o configura defaultProjectRoot " +
                "en mcp-vertex.config.json bajo plugins.export-to-postman.options.",
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
              // Interpolación de verdad: esto era una cadena entre comillas
              // dobles con `${workspaceRoot}` dentro, así que el agente leía
              // el placeholder literal en vez de la ruta.
              "Pasa projectRoot absoluto, o configura defaultProjectRoot en " +
                `mcp-vertex.config.json. Workspace actual: ${workspaceRoot}.`,
            );
          }

          const cliArgs = ["generate", "--project-root", projectRoot, "--json"];
          if (args.outputDir) cliArgs.push("--output-dir", args.outputDir);
          if (args.envs && args.envs.length > 0) {
            cliArgs.push("--envs", args.envs.join(","));
          }
          // Reintento con el framework que diga la persona, cuando la
          // detección no ha podido acertar.
          if (args.framework) cliArgs.push("--framework", args.framework);
          if (args.formats && args.formats.length > 0) {
            cliArgs.push("--format", args.formats.join(","));
          }
          if (args.openAfter) cliArgs.push("--open");

          const cliScriptPath = resolveCliScript(
            workspaceRoot,
            ctx.options["cliScript"] as string | undefined,
          );

          const result = runBunScript(cliScriptPath, cliArgs, {
            cwd: workspaceRoot,
          });
          if (!result.ok) {
            return toolError(
              `generate falló (exit=${result.exitCode}): ${result.stderr || result.stdout || "sin detalle"}`,
              // Sin esta segunda línea, "no se ha reconocido nada" era un
              // callejón sin salida: el agente no tenía forma de saber que
              // la persona a la que asiste puede resolverlo diciendo de qué
              // framework es su API.
              "Revisa que projectRoot apunte a un proyecto de API de alguno de los\n" +
                "frameworks soportados (ver docs/FRAMEWORKS.md).\n" +
                (args.framework
                  ? `Ya se ha forzado \`${args.framework}\`, así que el problema no es la detección: ` +
                    "comprueba que projectRoot sea la carpeta donde viven las rutas."
                  : "Si no ha reconocido el proyecto y sabes de qué framework es " +
                    "(monorepo, dependencia con alias, manifiesto generado en el build), " +
                    `reintenta pasando \`framework\`. Válidos: ${SUPPORTED_FRAMEWORKS.join(", ")}.`),
            );
          }
          const parsedReport = readGenerateReport(result.stdout);
          if (!parsedReport.ok) {
            return toolError(
              `generate terminó bien pero no se pudo leer su informe: ${parsedReport.detail}`,
              "El CLI y el plugin tienen que hablar el mismo contrato " +
                "(`contracts/generate-report.interface.ts`). Comprueba que ambos " +
                "estén a la misma versión.",
            );
          }
          const report = parsedReport.report;

          const out: IGenerateOutput = {
            ok: true,
            framework: report.framework,
            frameworks: report.frameworks,
            warnings: report.warnings,
            collectionPath: report.collectionPath,
            collectionId: report.collectionId,
            environmentPaths: report.environmentPaths,
            extraPaths: report.extraPaths,
            requests: report.requests,
            folders: report.folders,
            auth: report.auth,
            durationMs: result.durationMs,
          };
          return toolJson(out);
        },
      );
    },
  };
}
