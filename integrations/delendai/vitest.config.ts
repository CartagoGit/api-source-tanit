/**
 * Plugin vitest — independent project.
 *
 * The plugin is not just another folder of the CLI: it is its own
 * package, published separately and loaded inside delendai. That is
 * why it carries its own `vitest.config.ts`, like any plugin in the
 * delendai repo, and why the root picks it up as a workspace
 * instead of listing its tests as yet another section.
 *
 * Its tests spawn real processes (`bun test`, `bun run typecheck`
 * of the host project), hence the long timeout.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "plugin",
    include: ["tests/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    globals: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
