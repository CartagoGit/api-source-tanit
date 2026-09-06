/**
 * Tool `tanit_generate`.
 *
 * Runs the tanit project's `generate.script.ts` against the given
 * host project, returning the paths of the generated artefacts and
 * basic metrics.
 *
 * SOLID:
 *   - S: only orchestrates generation + output parsing.
 *   - O: can be extended (more flags) without touching the contract.
 *   - L: reads the JSON report from the CLI, never its human text.
 *   - D: depends on `runBunScript` (abstraction), not on Bun
 *     directly.
 *
 * Canonical `IToolRegistration` shape: the `id` is stable inside the
 * plugin (`tanit_generate`); the core qualifies it with the host's
 * `namespacePrefix`. The MCP tool name registered in the SDK is
 * built in `register(server)` with the same prefix.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
  type IMcpPluginContext,
} from "@delendai/core/public";

import {
  GenerateInputSchema,
  GenerateOutputSchema,
  type IGenerateOutput,
} from "../contracts/plugin.interface";
import { resolveCliScript } from "../contracts/cli-path.constant";

import {
  readGenerateReport,
  runBunScript,
} from "../helpers/runner.helper";
import { FRAMEWORK_IDS } from "../../../../contracts/constants/frameworks/framework-ids.constant";

/** Stable id of the tool inside the plugin's namespace. */
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
                "en delendai.config.json bajo plugins.tanit.options.",
            );
          }
          const args = parsed.data;

          // projectRoot resolution with the documented fallback:
          //   args.projectRoot ?? ctx.options.defaultProjectRoot ?? ctx.workspace
          // We validate that the result points to an existing directory.
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
              // True interpolation: this used to be a double-quoted
              // string with `${workspaceRoot}` inside, so the agent
              // read the literal placeholder instead of the path.
              "Pasa projectRoot absoluto, o configura defaultProjectRoot en " +
                `delendai.config.json. Workspace actual: ${workspaceRoot}.`,
            );
          }

          const cliArgs = ["generate", "--project-root", projectRoot, "--json"];
          if (args.outputDir) cliArgs.push("--output-dir", args.outputDir);
          if (args.envs && args.envs.length > 0) {
            cliArgs.push("--envs", args.envs.join(","));
          }
          // Retry with the framework the user names, when detection
          // could not get it right.
          if (args.framework) cliArgs.push("--framework", args.framework);
          if (args.formats && args.formats.length > 0) {
            cliArgs.push("--format", args.formats.join(","));
          }
          if (args.openAfter) cliArgs.push("--open");
          // `--framework-search-root` is passed to the CLI when
          // monorepo detection is not enough: the plugin option
          // (configured by the host in `delendai.config.json`) or
          // the value the agent passes to the tool. The subdir
          // validation (no leading `/`, no `..`) lives in the
          // pipeline; it is passed through unchanged here. f00011 S3.
          const pluginSearchRoot = ctx.options["frameworkSearchRoot"] as
            | string
            | undefined;
          const searchRoot = pluginSearchRoot ?? args.frameworkSearchRoot;
          if (searchRoot) cliArgs.push("--framework-search-root", searchRoot);

          const cliScriptPath = resolveCliScript(
            workspaceRoot,
            ctx.options["cliScript"] as string | undefined,
          );

          const result = runBunScript(cliScriptPath, cliArgs, {
            cwd: workspaceRoot,
            containRoots: [projectRoot],
            ctx: {
              cwd: workspaceRoot,
              // The binary comes from the validated plugin option
              // (or falls back to DELENDAI_BUN_BIN / Bun.which /
              // command -v that the helper applies). The env is
              // taken by the helper from its default: the plugin
              // does not need to read it.
              bunBin: ctx.options["delendaiBunBin"] as string | undefined,
            },
          });
          if (!result.ok) {
            return toolError(
              `generate falló (exit=${result.exitCode}): ${result.stderr || result.stdout || "sin detalle"}`,
              // Without this second line, "nothing was recognised"
              // was a dead end: the agent had no way to know that
              // the user it is helping can resolve it by saying
              // which framework their API is.
              "Revisa que projectRoot apunte a un proyecto de API de alguno de los\n" +
                "frameworks soportados (ver docs/FRAMEWORKS.md).\n" +
                (args.framework
                  ? `Ya se ha forzado \`${args.framework}\`, así que el problema no es la detección: ` +
                    "comprueba que projectRoot sea la carpeta donde viven las rutas."
                  : "Si no ha reconocido el proyecto y sabes de qué framework es " +
                    "(monorepo, dependencia con alias, manifiesto generado en el build), " +
                    `reintenta pasando \`framework\`. Válidos: ${FRAMEWORK_IDS.join(", ")}.`),
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
