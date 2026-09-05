/**
 * Tool `tanit_scan`.
 *
 * The step **before** everything else: what discovery sees before
 * the pipeline turns anything into requests. Which scanner won, by
 * which artefacts, and the raw routes it found.
 *
 * It is the answer to "why does it not find my routes?", which
 * until now an agent could only answer by generating the whole
 * collection and inferring it from the result. `summary` returns
 * the project already interpreted; this one returns the raw
 * material. When the two numbers do not match, the difference sits
 * exactly between these two tools.
 *
 * `detected: false` is not a tool error: not recognising the
 * framework is a legitimate result, and returning it as a failure
 * makes the agent retry instead of reading `artifacts` and
 * understanding why.
 *
 * Read-only: it neither generates nor writes anything. Hence
 * `effects: []`.
 */

import {
  toolError,
  toolJson,
  type IToolRegistration,
  type IMcpPluginContext,
} from "@delendai/core/public";

import {
  ScanInputSchema,
  ScanOutputSchema,
  type IScanOutput,
} from "../contracts/plugin.interface";
import { runScan } from "../../../../../cli/commands/scan.script";
import { resolveProjectContext } from "../../../../../core/discovery/project-context.service";

const TOOL_ID = "scan";

export function buildScanToolRegistration(ctx: IMcpPluginContext): IToolRegistration {
  return {
    id: TOOL_ID,
    summary:
      "Qué detecta el discovery en un proyecto: framework ganador, artefactos que " +
      "lo delatan, scanner elegido y las rutas crudas. Solo lectura: no genera nada.",
    tags: ["postman", "api", "scan", "discovery"],
    effects: [],
    register: async (server) => {
      server.registerTool(
        `${ctx.namespacePrefix}_${TOOL_ID}`,
        {
          description:
            "El diagnóstico del discovery, antes de generar nada: qué framework se " +
            "reconoció y por qué artefactos, qué scanner lo recorre, y las rutas " +
            "crudas que encuentra. Para responder «¿por qué no ve mis endpoints?».",
          inputSchema: ScanInputSchema,
          outputSchema: ScanOutputSchema,
        },
        async (input) => {
          const parsed = ScanInputSchema.safeParse(input);
          if (!parsed.success) {
            return toolError(
              `Input inválido: ${parsed.error.message}`,
              "Pasa projectRoot (ruta absoluta) o configura defaultProjectRoot.",
            );
          }
          const workspaceRoot = ctx.workspace.root;
          const defaultProjectRoot = ctx.options["defaultProjectRoot"] as
            | string
            | undefined;
          const projectRoot =
            parsed.data.projectRoot ?? defaultProjectRoot ?? workspaceRoot;

          const { existsSync } = await import("node:fs");
          if (!existsSync(projectRoot)) {
            return toolError(
              `projectRoot no existe: ${projectRoot}`,
              `Pasa projectRoot absoluto. Workspace actual: ${workspaceRoot}.`,
            );
          }

          const started = Date.now();
          const context = resolveProjectContext({ projectRoot });
          const outcome = await runScan([], context);

          const out: IScanOutput = {
            ok: true,
            // A scan without a framework is a result, not a failure:
            // the agent needs to see `artifacts` empty to understand
            // that the project has no recognisable manifest.
            detected: outcome.framework !== null,
            root: outcome.root,
            framework: outcome.framework,
            artifacts: [...outcome.artifacts],
            scanner: outcome.scanner,
            validation: outcome.validation,
            routes: outcome.routes.map((r) => ({
              method: r.method,
              uri: r.uri,
              tags: [...r.tags],
              description: r.description,
            })),
            durationMs: Date.now() - started,
          };
          return toolJson(out);
        },
      );
    },
  };
}
