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

    /**
     * Cobertura por líneas y ramas, con umbral.
     *
     * El repo medía la salud de sus tests **por cantidad**: dos mil
     * pasando suena bien y no dice qué zonas se tocan. Se puede mover una
     * capa entera a rojo semántico sin que el recuento se inmute — y de
     * hecho pasó: `list` no listaba nada en los 21 frameworks mientras la
     * suite estaba verde, porque nadie lo ejecutaba.
     *
     * Los umbrales son un **suelo medido**, no una aspiración: se ponen
     * en lo que hay hoy para que solo puedan subir. Perseguir un 100% a
     * martillazos produce tests que ejercitan líneas sin comprobar nada,
     * que es peor que no tenerlos porque además dan confianza.
     *
     * Fuera quedan las tres cosas que medir no significa nada: los
     * fixtures (código de otros proyectos, la entrada de los scanners),
     * el tooling del repo y las declaraciones de tipos.
     */
    coverage: {
      provider: "v8" as const,
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "build/coverage",
      include: ["projects/**/*.ts"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/*.d.ts",
        "tests/**",
        "scripts/**",
        "projects/plugins/**/tests/**",
      ],
      // Medido el 2026-08-08 sobre 2.000 tests:
      //   statements 73,88 · branches 62,38 · functions 82,89 · lines 75,65
      // El umbral va justo debajo de cada uno: así una regresión falla y
      // una mejora se puede fijar subiendo el número.
      //
      // `branches` es el punto flojo, y con diferencia. Tiene sentido:
      // los scanners están llenos de `if` sobre formas de código ajeno
      // —el `else` del que no trae `@Query`, el del manifiesto sin
      // `devDependencies`— y esas ramas solo se recorren con un fixture
      // que las provoque. Es la deuda de test que queda por pagar.
      thresholds: {
        statements: 73,
        branches: 62,
        functions: 82,
        lines: 75,
      },
    },
  },
});
