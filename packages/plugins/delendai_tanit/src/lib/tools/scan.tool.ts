/**
 * Tool `tanit_scan`.
 *
 * El paso **anterior** a todo lo demás: qué ve el discovery antes de que
 * el pipeline convierta nada en requests. Qué scanner ganó, por qué
 * artefactos, y las rutas crudas que encontró.
 *
 * Es la respuesta a «¿por qué no encuentra mis rutas?», que hasta ahora
 * un agente solo podía contestar generando la colección entera y
 * deduciéndolo del resultado. `summary` da el proyecto ya interpretado;
 * esto da la materia prima. Cuando los dos números no cuadran, la
 * diferencia está justo entre estos dos tools.
 *
 * `detected: false` no es un error del tool: no reconocer el framework es
 * un resultado legítimo, y devolverlo como fallo hace que el agente
 * reintente en vez de leer `artifacts` y entender por qué.
 *
 * Solo lectura: no genera ni escribe nada. De ahí `effects: []`.
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
            // Un escaneo sin framework es un resultado, no un fallo: el
            // agente necesita ver `artifacts` vacío para entender que el
            // proyecto no tiene manifiesto reconocible.
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
