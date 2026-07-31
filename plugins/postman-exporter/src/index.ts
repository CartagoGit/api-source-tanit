/**
 * `@postman-exporter/mcp-vertex-plugin` — entry point.
 *
 * Expone el proyecto postman-exporter como tools descubribles por
 * cualquier agente MCP-vertex compatible.
 *
 * Tools:
 *   - postman_exporter_generate
 *   - postman_exporter_validate
 *   - postman_exporter_summary
 *
 * Diseño:
 *   - Single source of truth en `IMcpPluginContext`.
 *   - Zero `process.cwd()` / `process.env` directos en tools (siempre
 *     vía contexto o args del tool).
 *   - SOLID: cada tool es una función pura que devuelve
 *     `IToolRegistration`.
 */

import { definePlugin } from "@mcp-vertex/core/public";

import { PostmanExporterOptionsSchema } from "./lib/contract/postman-exporter.interface";
import { buildGenerateToolRegistration } from "./lib/tools/generate.tool";
import { buildSummaryToolRegistration } from "./lib/tools/summary.tool";
import { buildValidateToolRegistration } from "./lib/tools/validate.tool";

export default definePlugin({
  name: "postman-exporter",
  version: "0.1.0",
  describe:
    "Genera, valida e inspecciona colecciones Postman v2.1.0 desde las rutas " +
    "de cualquier proyecto Laravel. Pensado para ser invocado por agentes " +
    "MCP-vertex en proyectos host sin configuración manual.",
  optionsSchema: PostmanExporterOptionsSchema,
  register(_ctx) {
    // Tools no necesitan opciones en este slice; la CLI del proyecto
    // host se autodetecta por convención de rutas (no por env).
    return {
      tools: [
        buildGenerateToolRegistration(),
        buildValidateToolRegistration(),
        buildSummaryToolRegistration(),
      ],
    };
  },
});
