/**
 * delendai plugin for tanit — entry point. INTERNAL USE: this
 * package is `"private": true`, it is not published and is loaded
 * from its TS source.
 *
 * Exposes the Tanit project as tools discoverable by any compatible
 * delendai agent.
 *
 * Tools, by what they do:
 *   - Write:      tanit_generate, tanit_init (configuration)
 *   - Publish:    tanit_push (the only one that leaves the machine)
 *   - Diagnose:   tanit_scan (what discovery sees),
 *                  tanit_summary (the project already interpreted)
 *   - Inspect the generated output: tanit_list, tanit_stats,
 *                  tanit_check (has it drifted?),
 *                  tanit_validate
 *   - Execute:    tanit_test
 *
 * The list used to be out of date — it said three when there were
 * already six — so now it is grouped by effect: a new tool cannot
 * land without deciding which group it joins, and `lint:mcp-surface`
 * verifies that decision.
 *
 * Design:
 *   - Single source of truth in `IMcpPluginContext`.
 *   - Zero direct `process.cwd()` / `process.env` reads in tools
 *     (always via context or tool args).
 *   - SOLID: each tool is a pure function returning
 *     `IToolRegistration` (canonical shape with `id` + `register(server)`).
 *   - No imports with a `.js` extension; this plugin runs at
 *     runtime in Bun (it is not compiled to `dist/`).
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
