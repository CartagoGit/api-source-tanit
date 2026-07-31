/**
 * `@postman-exporter/mcp-vertex-testing-plugin` — entry point.
 *
 * Tool:
 *   - postman_exporter_test
 *
 * Ejecuta los gates del paquete postman-exporter (typecheck, build,
 * check) desde cualquier agente MCP-vertex compatible.
 */

import { definePlugin } from "@mcp-vertex/core/public";

import { TestingOptionsSchema } from "./lib/contract/postman-exporter-testing.interface";
import { buildTestToolRegistration } from "./lib/tools/test.tool";

export default definePlugin({
  name: "postman-exporter-testing",
  version: "0.1.0",
  describe:
    "Valida la salud del paquete postman-exporter ejecutando typecheck, " +
    "build y check como un solo tool estructurado. Pensado para que un " +
    "agente MCP-vertex pregunte '¿está sano este paquete?' sin ejecutar " +
    "los scripts uno a uno.",
  optionsSchema: TestingOptionsSchema,
  register(ctx) {
    const workspaceRoot = ctx.workspace.toString();
    return {
      tools: [buildTestToolRegistration(workspaceRoot)],
    };
  },
});
