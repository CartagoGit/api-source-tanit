/**
 * Vitest del plugin — proyecto independiente.
 *
 * El plugin no es una carpeta más del CLI: es un paquete propio que se
 * publica aparte y que se carga dentro de mcp-vertex. Por eso lleva su
 * `vitest.config.ts`, igual que cualquier plugin del repo de
 * mcp-vertex, y por eso el root lo recoge como workspace en
 * vez de listar sus tests como una sección más.
 *
 * Sus tests arrancan procesos reales (`bun test`, `bun run typecheck`
 * del proyecto host), de ahí el timeout largo.
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
