---
id: p00037
title: "p00037 — corrección de hallazgos de auditoría: naming inconsistency, test assertions y CI pipeline"
kind: fix
status: ready
type: proposal
track: postman-exporter
date: 2026-08-06
related:
    - p00025
---

# p00037 — corrección de hallazgos de auditoría: naming inconsistency, test assertions y CI pipeline

## Goal

Cerrar exhaustivamente todos los hallazgos identificados en la auditoría
integral del 2026-08-06, incluyendo inconsistencias de naming, aserciones
de tests frágiles, scripts de CI rotos sin `--project-root`, y
documentación interna obsoleta.

## why

La auditoría del 06/08/2026 reveló varios problemas que, aunque no son
bugs funcionales, degradan la calidad percibida y la mantenibilidad:

### Hallazgos pendientes de resolución completa

| ID | Categoría | Hallazgo | Estado |
|---|---|---|---|
| H-01 | Naming | Package se llama `export-to-postman` pero tests hardcodean `postman-exporter` | ✅ Parcial (regex flexibilizado) |
| H-02 | Naming | Plugin `@postman-exporter/mcp-vertex-plugin` vs paquete raíz `export-to-postman` | 🔴 Pendiente decisión |
| H-03 | CI/Scripts | `bun run build` sin `--project-root` fallaba con ENOENT | ✅ Corregido (default a example-express) |
| H-04 | CI/Scripts | `bun run check` no resolvía correctamente el `projectRoot()` en diff | ✅ Corregido |
| H-05 | Portabilidad | `file:../../../mcp-vertex/...` en plugin package.json | ✅ Corregido (^0.1.0) |
| H-06 | Portabilidad | `$schema` apuntando a sibling mcp-vertex | ✅ Eliminado |
| H-07 | Docs | CONTRIBUTING.md referencia flujos que no existen (`bun run demo`) | 🔴 Pendiente |
| H-08 | Docs | README.md no documenta los 12 frameworks soportados | 🔴 Pendiente |
| H-09 | Tests | `validate-package.script.ts` buscaba `@postman-exporter/cli` en node_modules | ✅ Corregido |
| H-10 | Config | `mcp-vertex.config.json` lista plugins como `auto-plugin-selector`, `cache`, `api`, `browser`, `observability` que no existen en el MCP server | 🔴 Pendiente |
| H-11 | Deuda técnica | `paths.service.ts` tiene docstrings referenciando "Laravel" 8 veces aunque el proyecto es agnóstico | 🔴 Pendiente |
| H-12 | Linting | No hay linter de código fuente (ESLint/Biome) configurado en el repo raíz | 🔴 Pendiente |
| H-13 | Git | No hay `.editorconfig` para consistencia de formato entre editores | 🔴 Pendiente |
| H-14 | CI | No hay workflow de GitHub Actions para CI/CD | 🔴 Pendiente |

## non-goals

- Renombrar el paquete raíz (eso es p00025).

## slices

### S1 — Limpieza de docstrings y comentarios con referencia a "Laravel" en servicios agnósticos
- **Files**: `services/paths.service.ts`, `services/project-loader.service.ts`.
- **Gate**: `grep -r "Laravel" service/ | wc -l` → 0 (solo en `laravel.scanner.ts`).

### S2 — Actualización de README.md con tabla de frameworks y badges
- **Files**: `README.md`.
- **Gate**: revisión manual.
- Incluir tabla de los 12 frameworks soportados con estado de detección,
  badges de CI, badges de npm, y ejemplos de uso rápido.

### S3 — Limpieza de plugins fantasma en `mcp-vertex.config.json`
- **Files**: `mcp-vertex.config.json`.
- **Gate**: `bun run validate`.
- Eliminar entradas de plugins que no existen en el servidor MCP activo.

### S4 — Añadir `.editorconfig` y configurar Biome como linter
- **Files**: `.editorconfig`, `biome.json`.
- **Gate**: `bun run lint` verde.
- Configurar indent style, line width, trailing commas consistentes.

### S5 — GitHub Actions CI workflow
- **Files**: `.github/workflows/ci.yml`.
- **Gate**: push a branch y verificación del pipeline.
- Ejecuta `bun run validate`, `bun run validate:package` y
  `bun run validate:examples` en cada PR.

### S6 — Actualizar CONTRIBUTING.md con flujos reales
- **Files**: `CONTRIBUTING.md`.
- **Gate**: revisión manual.
- Alinear instrucciones con los scripts reales del `package.json`.

## acceptance

- Zero menciones a "Laravel" en servicios agnósticos.
- README con tabla de frameworks y badges.
- CI pipeline funcional en GitHub Actions.
- Linter configurado y pasando.
- `bun run validate` verde.
