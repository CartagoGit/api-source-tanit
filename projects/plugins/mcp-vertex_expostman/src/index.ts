/**
 * `@expostman/mcp-vertex-plugin` — entry point.
 *
 * Expone el proyecto export-to-postman como tools descubribles por
 * cualquier agente MCP-vertex compatible.
 *
 * Tools, por lo que hacen:
 *   - Escriben:   expostman_generate
 *   - Diagnostican: expostman_scan (qué ve el discovery),
 *                   expostman_summary (el proyecto ya interpretado)
 *   - Inspeccionan lo generado: expostman_list, expostman_stats,
 *                   expostman_check (¿se ha desincronizado?),
 *                   expostman_validate
 *   - Ejecutan:   expostman_test
 *
 * La lista vivía desactualizada —decía tres cuando ya había seis—, así
 * que ahora se agrupa por efecto: un tool nuevo no cabe sin decidir en
 * qué grupo entra, y esa decisión es la que `lint:mcp-surface` verifica.
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
import { buildCheckToolRegistration } from "./lib/tools/check.tool";
import { buildGenerateToolRegistration } from "./lib/tools/generate.tool";
import { buildListToolRegistration } from "./lib/tools/list.tool";
import { buildScanToolRegistration } from "./lib/tools/scan.tool";
import { buildStatsToolRegistration } from "./lib/tools/stats.tool";
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
        buildCheckToolRegistration(ctx),
        buildListToolRegistration(ctx),
        buildStatsToolRegistration(ctx),
        buildScanToolRegistration(ctx),
        buildSummaryToolRegistration(ctx),
        buildTestToolRegistration(ctx),
      ],
    };
  },
});
