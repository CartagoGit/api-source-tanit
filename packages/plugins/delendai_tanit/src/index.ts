/**
 * Plugin delendai de tanit — entry point. USO INTERNO: este
 * paquete es `"private": true`, no se publica y se carga desde su TS.
 *
 * Expone el proyecto Tanit como tools descubribles por cualquier
 * agente delendai compatible.
 *
 * Tools, por lo que hacen:
 *   - Escriben:   tanit_generate, tanit_init (la configuracion)
 *   - Publican:   tanit_push (el unico que sale de la maquina)
 *   - Diagnostican: tanit_scan (qué ve el discovery),
 *                   tanit_summary (el proyecto ya interpretado)
 *   - Inspeccionan lo generado: tanit_list, tanit_stats,
 *                   tanit_check (¿se ha desincronizado?),
 *                   tanit_validate
 *   - Ejecutan:   tanit_test
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

import { definePlugin } from "@delendai/core/public";

import { TanitOptionsSchema } from "./lib/contracts/plugin.interface";
import { buildCheckToolRegistration } from "./lib/tools/check.tool";
import { buildGenerateToolRegistration } from "./lib/tools/generate.tool";
import { buildInitToolRegistration } from "./lib/tools/init.tool";
import { buildListToolRegistration } from "./lib/tools/list.tool";
import { buildPushToolRegistration } from "./lib/tools/push.tool";
import { buildScanToolRegistration } from "./lib/tools/scan.tool";
import { buildStatsToolRegistration } from "./lib/tools/stats.tool";
import { buildSummaryToolRegistration } from "./lib/tools/summary.tool";
import { buildTestToolRegistration } from "./lib/tools/test.tool";
import { buildValidateToolRegistration } from "./lib/tools/validate.tool";

export default definePlugin({
  name: "tanit",
  version: "0.1.1",
  describe:
    "Genera, valida e inspecciona colecciones Postman v2.1.0 desde las rutas " +
    "de cualquier proyecto de API. Pensado para ser invocado por agentes " +
    "delendai en proyectos host sin configuración manual.",
  optionsSchema: TanitOptionsSchema,
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
        buildPushToolRegistration(ctx),
        buildInitToolRegistration(ctx),
      ],
    };
  },
});
