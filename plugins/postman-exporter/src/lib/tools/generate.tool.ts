/**
 * Tool `postman_exporter_generate`.
 *
 * Ejecuta el script `generate.script.ts` del proyecto postman-exporter
 * contra un proyecto Laravel host, devolviendo las rutas de los
 * artefactos generados y métricas básicas.
 *
 * SOLID:
 *   - S: solo orquesta la generación + parseo de output.
 *   - O: se puede extender (más flags) sin tocar el contrato.
 *   - L: prefiere parseGenerateOutput sobre regex ad-hoc.
 *   - I: input/output tipados, sin estado compartido.
 *   - D: depende de `runBunScript` (abstracción), no de Bun directo.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
} from "@mcp-vertex/core/public";

import { GenerateInputSchema, type IGenerateOutput } from "../contract/postman-exporter.interface";
import {
  parseGenerateOutput,
  parseRequestCount,
  runBunScript,
} from "../helpers/runner.helper";

const NAMESPACE = "postman";

function resolveCliScript(
  workspaceRoot: string,
  overrideFromOptions: string | undefined,
): string {
  if (overrideFromOptions) return overrideFromOptions;
  return `${workspaceRoot}/scripts/cli.script.ts`;
}

function resolveProjectRoot(
  workspace: { toString(): string },
  input: { projectRoot: string | undefined },
  fallback: string | undefined,
): string {
  if (input.projectRoot) return input.projectRoot;
  if (fallback) return fallback;
  return workspace.toString();
}

export function buildGenerateToolRegistration(): IToolRegistration {
  return {
    name: `${NAMESPACE}_exporter_generate`,
    description:
      "Genera la colección Postman v2.1.0 desde las rutas de un proyecto Laravel host. " +
      "Devuelve rutas de los archivos generados (colección + environments) y métricas.",
    inputSchema: GenerateInputSchema,
    async handler(input: unknown): Promise<ReturnType<typeof toolJson>> {
      const parsed = GenerateInputSchema.safeParse(input);
      if (!parsed.success) {
        return toolError(
          `Input inválido: ${parsed.error.message}`,
          "Asegúrate de pasar projectRoot (ruta absoluta a un proyecto Laravel).",
        );
      }
      const args = parsed.data;

      // Resolver workspace desde el contexto del plugin (single source of truth).
      const workspaceRoot = process.cwd(); // el plugin corre en el workspace del proyecto host
      const defaultProjectRoot =
        (typeof args.projectRoot === "string" ? undefined : undefined) ||
        undefined;
      const projectRoot = resolveProjectRoot(
        workspaceRoot,
        { projectRoot: args.projectRoot },
        defaultProjectRoot,
      );

      const cliArgs = ["generate", "--project-root", projectRoot];
      if (args.outputDir) cliArgs.push("--output-dir", args.outputDir);
      if (args.envs && args.envs.length > 0) {
        cliArgs.push("--envs", args.envs.join(","));
      }
      if (args.openAfter) cliArgs.push("--open");

      const result = runBunScript(
        resolveCliScript(workspaceRoot, undefined),
        cliArgs,
        { cwd: workspaceRoot },
      );
      if (!result.ok) {
        return toolError(
          `generate falló (exit=${result.exitCode}): ${result.stderr || result.stdout || "sin detalle"}`,
          "Revisa que projectRoot apunte a un Laravel con artisan + routes + app.",
        );
      }
      const parsedOutput = parseGenerateOutput(result.stdout);
      const counts = parseRequestCount(result.stdout);
      const out: IGenerateOutput = {
        collectionPath: parsedOutput.collectionPath ?? "<no detectado>",
        environmentPaths: parsedOutput.environmentPaths,
        requests: counts?.requests ?? 0,
        folders: counts?.folders ?? 0,
        variables: 0,
        durationMs: result.durationMs,
      };
      return toolJson(out);
    },
  };
}
