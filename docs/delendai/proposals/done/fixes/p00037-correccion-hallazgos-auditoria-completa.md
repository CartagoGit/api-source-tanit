---
id: p00037
title: "p00037 — corrección de hallazgos de auditoría: naming inconsistency, test assertions y CI pipeline"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00025
shippedIn:
  - 58a680a  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

> **Cerrada 2026-08-07.** Los 14 hallazgos.
>
> **Sobre H-12 (linter).** Se probó Biome y se descartó: sobre este
> repo daba 281 errores de formato en 164 ficheros, casi todos
> desacuerdos de estilo con código que ya es consistente. Adoptarlo
> habría reescrito el repo entero para enterrar los cambios reales
> en el ruido.
>
> Sí se revisaron sus hallazgos de `correctness`, y de ahí salió
> valor: **135 declaraciones muertas** (regexes, helpers y un tipo
> que ya no usaba nadie, restos de reescrituras anteriores). Se
> borraron y se activaron `noUnusedLocals` y `noUnusedParameters`
> en el tsconfig base, que es la herramienta que el proyecto ya
> tenía y que ya está en el gate. Cero dependencias nuevas.


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
| H-02 | Naming | Plugin vs paquete raíz | ✅ p00025: todo es `expostman` |
| H-03 | CI/Scripts | `bun run build` sin `--project-root` fallaba con ENOENT | ✅ Corregido (default a example-express) |
| H-04 | CI/Scripts | `bun run check` no resolvía correctamente el `projectRoot()` en diff | ✅ Corregido |
| H-05 | Portabilidad | `file:` en el plugin | ✅ Restaurado a `file:` — `^0.1.0` daba 404 porque el paquete no está publicado (p00007) |
| H-06 | Portabilidad | `$schema` apuntando a sibling delendai | ✅ Eliminado |
| H-07 | Docs | `bun run demo` inexistente | ✅ Ya no se menciona |
| H-08 | Docs | README sin los 12 frameworks | ✅ Tabla presente |
| H-09 | Tests | `validate-package.script.ts` buscaba `@postman-exporter/cli` en node_modules | ✅ Corregido |
| H-10 | Config | `delendai.config.json` lista plugins como `auto-plugin-selector`, `cache`, `api`, `browser`, `observability` que no existen en el MCP server | ✅ Verificado en vivo: 39 plugins cargados, 0 errores |
| H-11 | Deuda técnica | Docstrings de Laravel en el núcleo agnóstico | ✅ Corregidos los que engañaban; los que explican el porqué histórico se quedan |
| H-12 | Linting | Sin linter de código fuente | ✅ Resuelto con `noUnusedLocals`/`noUnusedParameters` de TypeScript, no con Biome (ver nota) |
| H-13 | Git | Sin `.editorconfig` | ✅ Añadido, con valores derivados del código que ya hay |
| H-14 | CI | Sin CI | ✅ Ya existían `validate.yml` y `release-binaries.yml`, y corren el gate |

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

### S3 — Limpieza de plugins fantasma en `delendai.config.json`
- **Files**: `delendai.config.json`.
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
