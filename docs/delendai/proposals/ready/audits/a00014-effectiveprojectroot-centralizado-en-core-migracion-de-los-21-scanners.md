---
id: a00014
title: "effectiveProjectRoot centralizado en core + migración de los 21 scanners"
kind: audit
status: ready
type: proposal
track: export-to-postman
date: 2026-09-04
shippedIn:
  - 3a1a4f9  # S1: helper effectiveProjectRoot + 13 tests
  - 6a539e3  # S2: migrar 20 scanners a effectiveProjectRoot(match)
  - 070836c  # S3: lint:effective-project-root gate
  - f0a3aa5  # merge into develop + push
dependsOn:
  - a00012
related:
  - a00009
  - a00013
  - f00010
---

# a00014 — effectiveProjectRoot centralizado

> **Revisión 2026-09-05 (cierre reabierto — este audit todavía NO cerrado).**
> Hallazgo confirmado contra el código actual de develop (commit `7080255`…
> `9374020`): `effectiveProjectRoot()` **sí** acepta rutas absolutas y las
> devuelve verbatim:
>
> ```ts
> // packages/core/discovery/effective-project-root.helper.ts
> if (isAbsolute(requested)) return requested;
> ```
>
> Esto contradice abiertamente el contrato de `IProjectMatch.frameworkSearchRoot`
> (`packages/contracts/interfaces/core/scanner.interface.ts:54-57`):
> *"…never absolute"*. Los tests actuales *declaran explícitamente* ese verbatim
> como correcto, así que la prueba es cómplice de la contradicción. **Prohibido
> cerrar a00014** con este comportamiento: un `frameworkSearchRoot` que apunte a
> `/etc`, `C:\Windows` o `\\server\share` volvería a abrir la fuga de containment
> que ya se cerró en x00022.
>
> Slices correctivos añadidos: **S4** (rechazar absolutos + primitiva de
> contención común). **S5** corrige la contradicción del slice de test.

## Goal

Crear una única primitiva effectiveProjectRoot(match) en
packages/core/discovery/effective-project-root.helper.ts y migrar
los 21 scanners a consumirla, de modo que ningún scanner pueda
ignorar frameworkSearchRoot por accidente.

## Why

El audit 2026-09-04 documentó que frameworkSearchRoot no se honra
uniformemente:

- NestJS / Hono / Next ya integran una raíz efectiva específica
  (lógica duplicada, no cross-checked).
- Express hasta la penúltima iteración hacía
  collectJsFiles(match.projectRoot) ignorando match.frameworkSearchRoot.
  La opción --framework-search-root apps/api devolvía el candidato
  correcto, pero el route scanner volvía a mirar la raíz del
  monorepo y leía apps/admin también.
- El resto de scanners no tiene protección.

## Non-goals

- No cambia la semántica de effectiveScanRoot (esa vive en
  scan-root.helper.ts y ya está centralizada vía S1.b de a00012).
- No introduce una API pública para usuarios externos.
- No elimina match.frameworkSearchRoot del contrato, solo lo respeta.
- **No acepta `frameworkSearchRoot` absolutos** (ver el blockquote de revisión de
  2026-09-05 arriba). Si algún día se necesitan specs compartidos fuera del
  proyecto, que tengan un campo propio y explícito (`externalArtifacts` /
  `sharedSchemaRoots`), no una reinterpretación de `frameworkSearchRoot`.

## Slices

### S1 — Helper único effectiveProjectRoot

- **Status**: pending
- **Files**:
  - packages/core/discovery/effective-project-root.helper.ts (nuevo)
  - packages/core/discovery/effective-project-root.helper.spec.ts (nuevo)
- **Gate**: bun run typecheck && bun run test:core
- **Detalle**:
  - Función pura effectiveProjectRoot(match: IFrameworkMatch): string
    que devuelve match.frameworkSearchRoot si existe y es absoluto o
    relativo a match.projectRoot; si no, match.projectRoot.
  - 8 tests:
    - match.frameworkSearchRoot undefined → projectRoot
    - frameworkSearchRoot = 'apps/api' → join(projectRoot, 'apps/api')
    - frameworkSearchRoot = '/abs/path' → '/abs/path'
    - frameworkSearchRoot = '' → projectRoot
  - Re-export en packages/core/index.ts.

### S2 — Migración de los 21 scanners

- **Status**: pending
- **Files**: cada packages/frameworks/**/*.scanner.ts que use
  match.projectRoot para source-file walk.
- **Gate**: bun run test:frameworks && bun run test:coverage
- **Detalle**:
  - Lista: express, fastify, nestjs, nextjs, hono, fastapi, flask,
    django, fiber, gin, laravel, symfony, springboot, ktor, phoenix,
    rails, aspnet, rust, graphql, trpc, openapi.
  - Cada scanner invoca effectiveProjectRoot(match) para:
    a) enumerar rutas de scan (route walker),
    b) resolver sourceFile para IDetectionEvidence,
    c) descubrir schemas (FastAPI/Laravel).
  - Tests por scanner: frameworkSearchRoot definido durante walk.

### S3 — Gate que rechaza scanners incompatibles

- **Status**: pending
- **Files**: scripts/gates/lint-effective-project-root.script.ts (nuevo).
- **Gate**: entra en bun run lint.
- **Detalle**:
  - Ningún *.scanner.ts puede usar match.projectRoot sin pasar por
    effectiveProjectRoot.
  - Whitelist explícita solo en el helper.
  - Quien necesite projectRoot real debe llamar rawProjectRoot(match)
    que el gate también controla.

### S4 — Rechazar absolutos + primitiva de contención única (CORRECTIVO — pendiente)

- **Status**: pending
- **Files**:
  - `packages/core/discovery/effective-project-root.helper.ts` (eliminar el
    `if (isAbsolute) return requested`)
  - `packages/core/helpers/path.helper.ts` (o donde viva ya el `toProjectRelative`
    de x00022: reutilizar esa primitiva en lugar de reimplementar `startsWith`)
  - `tests/core/effective-project-root.helper.spec.ts`
- **Gate**: `bun run typecheck && bun run test:core`
- **Detalle**:
  - `frameworkSearchRoot` absoluto → **lanzar** error explícito (mismo patrón que
    el error de `..`): no devolver verbatim. El contrato dice "only one segment,
    never absolute".
  - Reutilizar la primitiva de contención robusta ya existente
    (`relative()` + comprobación de `..` + symlink-resolución — x00022): **no**
    mantener dos algoritmos distintos de containment, que es lo que el helper hace
    hoy (`resolved.startsWith(root + sep)`).
  - Ajustar el error del `Error` para mencionar ambos modos de escape (`..`,
    absoluto).

### S5 — Actualizar tests de absoluta a rechazada (pendiente, depende de S4)

- **Status**: pending
- **Files**: `tests/core/effective-project-root.helper.spec.ts`
- **Gate**: `bun run test:core`
- **Detalle**:
  - El test `frameworkSearchRoot = '/abs/path' → '/abs/path'` pasa a esperar
    `toThrow()`.
  - Nuevo: `'/etc'`, `'C:\\Windows'`, `'\\\\server\\share'` → toThrow.
  - Nuevo (si aplica en el host): symlink fuera de `projectRoot` → toThrow
    (paridad con el `toProjectRelative` de x00022).

## acceptance

1. Los 21 scanners pasan tests con frameworkSearchRoot definido.
2. El gate lint:effective-project-root rechaza cualquier scanner que
   lea match.projectRoot directamente.
3. bun run validate verde end-to-end.
4. Coverage sin regresión local.
