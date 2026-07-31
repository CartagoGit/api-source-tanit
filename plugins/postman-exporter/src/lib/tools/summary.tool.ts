/**
 * Tool `postman_exporter_summary`.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
} from "@mcp-vertex/core/public";
import z from "zod";

import {
  SummaryInputSchema,
  type ISummaryOutput,
} from "../contract/postman-exporter.interface";
import { runBunScript } from "../helpers/runner.helper";

// Note: the `id` must be the short tool name (without any namespace
// prefix). The server's `qualifiedId` rule (`${corePrefix}_${ns}_${tool.id}`)
// adds the plugin namespace automatically; pre-prefixing here would
// produce a double namespace like `mcp-vertex_postman-exporter_postman_exporter_*`.

const OUTPUT = z
  .object({
    projectName: z.string(),
    baseUrl: z.string(),
    routesInCode: z.number().int().min(0),
    formRequestsResolved: z.number().int().min(0),
    zeroConfig: z.boolean(),
    configPath: z.string(),
  })
  .strict();

export const buildSummaryToolRegistration = (
  workspaceRoot: string,
): IToolRegistration => ({
  id: `summary`,
  tags: ["postman", "inspector"],
  summary:
    "Inspecciona un proyecto Laravel host sin generar artefactos.",
  register: async (server) => {
    server.registerTool(
      `${NAMESPACE}_exporter_summary`,
      {
        description:
          "Inspecciona un proyecto Laravel host sin generar artefactos. Devuelve " +
          "nombre detectado, baseUrl, rutas en código, FormRequests resueltos y modo.",
        inputSchema: SummaryInputSchema,
        outputSchema: OUTPUT,
      },
      async (args: z.infer<typeof SummaryInputSchema>) => {
        const tmpDir = "/tmp/postman-exporter-summary";
        const result = runBunScript(
          `${workspaceRoot}/scripts/generate.script.ts`,
          ["generate", "--project-root", args.projectRoot, "--output-dir", tmpDir],
          { cwd: workspaceRoot, timeoutMs: 30_000 },
        );
        if (!result.ok) {
          return toolError(
            `summary falló (exit=${result.exitCode}): ${result.stderr || result.stdout || "sin detalle"}`,
            "Revisa que projectRoot apunte a un Laravel con artisan + routes + app.",
          );
        }
        const configMatch = result.stdout.match(/Config host:\s+(.+)/);
        const routesMatch = result.stdout.match(/(\d+)\s+rutas en c[oó]digo/);
        const frMatch = result.stdout.match(/\(FormRequest:\s+(\d+)/);
        const configPath = configMatch?.[1]?.trim() ?? "<zero-config>";
        const out: ISummaryOutput = {
          projectName: configPath,
          baseUrl: "<inferida por zero-config o config del host>",
          routesInCode: routesMatch ? Number(routesMatch[1]) : 0,
          formRequestsResolved: frMatch ? Number(frMatch[1]) : 0,
          zeroConfig: configPath.includes("<zero-config>"),
          configPath,
        };
        return toolJson(out);
      },
    );
  },
});
