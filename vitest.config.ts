/**
 * Raíz de vitest — un `project` por sección.
 *
 * Los projects no se listan a mano: salen de `SECTIONS`
 * (`scripts/gates/sections.ts`), que es el mismo registro que usan el
 * typecheck, el lint de límites y el runner por zona modificada. Añadir
 * una sección la da de alta en los cuatro sitios a la vez.
 *
 *   bun run test                 → todas las secciones
 *   bun run test:core            → solo el núcleo agnóstico
 *   bun run test:frameworks      → solo los scanners
 *   bun run test:changed         → solo lo que toca tu diff
 *
 * El plugin queda fuera de esta lista a propósito: es un proyecto
 * independiente con su propio `vitest.config.ts`, y entra por el glob
 * `projects/plugins/mcp-vertex_expostman` como haría cualquier otro paquete del workspace.
 */
import { defineConfig } from "vitest/config";

import { SECTIONS } from "./scripts/gates/sections.constant.js";

const PLUGIN_SECTION = "plugin";

export default defineConfig({
  test: {
    projects: [
      ...SECTIONS.filter((section) => section.name !== PLUGIN_SECTION).map(
        (section) => ({
          test: {
            name: section.name,
            include: [...section.tests],
            exclude: ["**/node_modules/**", "**/dist/**", "**/build/**"],
            environment: "node" as const,
            globals: false,
            // Los e2e generan colecciones enteras desde fixtures en
            // disco; 30 s cubre el peor caso medido (~4 s) con margen
            // para una máquina cargada.
            testTimeout: 30_000,
            hookTimeout: 30_000,
          },
        }),
      ),
      "projects/plugins/mcp-vertex_expostman",
    ],
  },
});
