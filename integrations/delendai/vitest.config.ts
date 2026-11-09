/** Independent opt-in tests for the private, optional MCP integration.
 * Real CLI subprocesses inherit isolated history paths from the shared setup.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["../../tests/helpers/history-isolation.setup.ts"],
    name: "plugin",
    include: ["tests/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    globals: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
