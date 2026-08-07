/**
 * `@expostman/mcp-vertex-plugin` — entry point.
 *
 * Expone el proyecto export-to-postman como tools descubribles por
 * cualquier agente MCP-vertex compatible.
 *
 * Tools:
 *   - expostman_generate
 *   - expostman_validate
 *   - expostman_summary
 *
 * Diseño:
 *   - Single source of truth en `IMcpPluginContext`.
 *   - Zero `process.cwd()` / `process.env` directos en tools (siempre
 *     vía contexto o args del tool).
 *   - SOLID: cada tool es una función pura que devuelve
 *     `IToolRegistration` (forma canónica con `id` + `register(server)`).
 *   - Sin imports con extensión `.js`; este plugin se ejecuta en
 *     runtime con Bun (no se compila a `dist/`).
 */

import { definePlugin } from "@mcp-vertex/core/public";

import { ExportToPostmanOptionsSchema } from "./lib/contracts/plugin.interface";
import { buildGenerateToolRegistration } from "./lib/tools/generate.tool";
import { buildSummaryToolRegistration } from "./lib/tools/summary.tool";
import { buildTestToolRegistration } from "./lib/tools/test.tool";
import { buildValidateToolRegistration } from "./lib/tools/validate.tool";

export default definePlugin({
  name: "expostman",
  version: "0.1.0",
  describe:
    "Genera, valida e inspecciona colecciones Postman v2.1.0 desde las rutas " +
    "de cualquier proyecto de API. Pensado para ser invocado por agentes " +
    "MCP-vertex en proyectos host sin configuración manual.",
  optionsSchema: ExportToPostmanOptionsSchema,
  register(ctx) {
    return {
      tools: [
        buildGenerateToolRegistration(ctx),
        buildValidateToolRegistration(ctx),
        buildSummaryToolRegistration(ctx),
        buildTestToolRegistration(ctx),
      ],
    };
  },
});
