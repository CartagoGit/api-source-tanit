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
 * El plugin (integración opcional con Delendai) NO entra aquí: vive
 * en `integrations/delendai/` con su propio `vitest.config.ts`. Sus
 * tests se corren en `.github/workflows/integration-delendai.yml`
 * (opt-in + semanal). x00041.
 */
import { defineConfig } from "vitest/config";

import { COVERAGE_THRESHOLDS } from "./scripts/gates/coverage-policy.constant.js";
import { SECTIONS } from "./scripts/gates/sections.constant.js";

export default defineConfig({
  test: {
    projects: SECTIONS.map(
      (section) => ({
        test: {
          name: section.name,
          include: [...section.tests],
          exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "**/build/**",
            ...(section.name === "core" ? ["tests/core/state/sqlite/**"] : []),
          ],
          environment: section.name === "app" ? ("jsdom" as const) : ("node" as const),
          ...(section.name === "app" ? { environmentOptions: { jsdom: { url: "http://tanit.test" } } } : {}),
          globals: false,
          // Los e2e generan colecciones enteras desde fixtures en
          // disco; 30 s cubre el peor caso medido (~4 s) con margen
          // para una máquina cargada.
          testTimeout: 30_000,
          hookTimeout: 30_000,
          // El gate `coverage.script.ts` agrega exactamente estos perfiles
          // por prefijo; mantenerlos aquí hace visible el contrato en Vitest.
          coverage:
            section.name === "core"
              ? {
                  include: ["packages/core/**/*.ts"],
                  // Dos subárboles Bun-nativos del núcleo no son
                  // instrumentables por `@vitest/coverage-v8` y por
                  // tanto no entran en la cobertura per-project de
                  // core. Ambos se ejecutan con `bun test` (split
                  // intencional documentado en `package.json` —
                  // `bun test test:core:sqlite`, y `bun test
                  // tests/transport/` es el paralelo para el bridge).
                  //
                  // - `state/sqlite/**`: importa `bun:sqlite`, que
                  //   v8 sobre Node no puede perfilar.
                  // - `transport/**`: arranca `Bun.serve` y depende
                  //   del runtime de Bun para el carrier HTTP.
                  //
                  // Sin excluir también el código fuente, vitest
                  // reporta 0% sobre superficies que **sí** tienen
                  // cobertura en otro runner — y eso hunde el gate
                  // sin que sea una regresión del código.
                  exclude: [
                    "**/*.d.ts",
                    "packages/core/state/sqlite/**",
                    "packages/core/transport/**",
                  ],
                  thresholds: COVERAGE_THRESHOLDS.core,
                }
              : section.name === "frameworks"
                ? {
                    include: ["packages/frameworks/**/*.ts"],
                    exclude: ["**/*.d.ts"],
                    thresholds: COVERAGE_THRESHOLDS.frameworks,
                  }
                : section.name === "cli"
                  ? {
                      include: ["packages/cli/**/*.ts"],
                      exclude: ["**/*.d.ts"],
                      thresholds: COVERAGE_THRESHOLDS.cli,
                    }
                  : undefined,
        },
      }),
    ),

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
      include: ["packages/**/*.ts"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/*.d.ts",
        "tests/**",
        "scripts/**",
        // Subárboles Bun-nativos del núcleo: justificación completa
        // en el `coverage` de la sección `core` arriba. Se repiten
        // aquí porque el `include` global (`packages/**/*.ts`) los
        // capturaría otra vez; los dos sitios deben coincidir para
        // que el contrato sea visible desde cada uno de los dos
        // configs.
        "packages/core/state/sqlite/**",
        "packages/core/transport/**",
        // Aplicación Angular standalone + shell Tauri (`f00017`).
        // Esta superficie corre dentro del WebView de Tauri y
        // depende de `window.__TAURI__`, del keyring nativo y del
        // filesystem del escritorio — los `*.spec.ts` usan Angular
        // TestBed + jsdom para los componentes que sí están
        // cableados (carpeta `tests/app/`), pero los puntos de
        // entrada, directivas y conectores de host (drag-drop,
        // secure-storage, host-bridge, …) no son ejecutables desde
        // vitest sin un shim del runtime de Tauri, y mockearlo
        // produciría cobertura falsa. La cobertura real de la app
        // vive en CI desktop (Playwright/Tauri) y en pruebas
        // manuales; medirla aquí, a 0%, no protege contra
        // regresiones — solo introduce ruido que hunde el global.
        "packages/app/**",
      ],
      // Medido el 2026-08-08 sobre 2.000 tests:
      //   statements 73,88 · branches 62,38 · functions 82,89 · lines 75,65
      // El umbral va justo debajo de cada uno: así una regresión falla y
      // una mejora se puede fijar subiendo el número.
      //
      // `branches` era el punto flojo, y con diferencia. Tiene sentido:
      // los scanners están llenos de `if` sobre formas de código ajeno
      // —el `else` del que no trae `@Query`, el del manifiesto sin
      // `devDependencies`— y esas ramas solo se recorren con un fixture
      // que las provoque. La deuda se pagó con fixtures (t00004,
      // 2026-08-30): el lote laravel/django/openapi + core subió la
      // medida a 72,0 % y el umbral pasa de 62 a 70.
      thresholds: COVERAGE_THRESHOLDS.global,
    },
  },
});
