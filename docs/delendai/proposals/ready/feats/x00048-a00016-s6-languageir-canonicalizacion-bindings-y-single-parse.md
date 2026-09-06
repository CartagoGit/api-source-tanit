---
id: x00048
kind: feat
title: "x00048: a00016 S6 — LanguageIR completo (alias canonicalisation, bindings reales, single-parse, NestJS)"
status: ready
priority: P1
globalGate: type
why: |
  La auditoría `a00016` (Frontend TypeScript multi-estilo →
  LanguageIR) está archivada como `done` desde el 2026-09-04, con
  6 slices shipped. Pero su propio documento (líneas de
  "Status: pending" en S6) reconoce que **la integración real no
  está terminada**: 4 sub-slices (S6.a, S6.c, S6.d, S6.e) siguen
  pendientes.

  El auditor 2026-09-05 reabrió la propuesta por esto mismo:
  "frontmatter: done / folder: done/ / body: pending — no aceptar
  su cierre tal como está".

  El universal §4 dice "Archived proposals are frozen. must not be
  transitioned, edited, or have their slice statuses changed". Y
  x00032 (lint:proposals garantía) exige que un `done` no tenga
  slices pending dentro. La contradicción es la que el análisis
  2026-09-05 señaló: frontmatter miente, body dice la verdad.

  La solución limpia, recomendada por el propio análisis, es
  **NO reabrir a00016** (rompe el contrato de "archived = frozen")
  y **extraer los 4 sub-slices a una propuesta nueva** (ésta) que
  recoge el trabajo restante con su propio plan de cierre. Cuando
  x00048 se archive, a00016 seguirá marcado `done` pero su body
  reconocerá que el trabajo restante vive en x00048 (puede
  actualizarse el body sin tocar el frontmatter — es texto
  descriptivo, no frontmatter).
nonGoals:
  - Tocar los slices S1–S5 de a00016 (están cerrados y verificados).
  - Tocar el frontmatter de a00016 (sigue siendo `done`, intacto).
  - Reemplazar el IR con un type checker formal (la propagación
    sigue siendo intraprocedural + heurística, como dice a00016).
  - Implementar resolución cross-package (también está en
    non-goals de a00016 y sigue vigente).
globalGate: type
acceptance:
  - Los 4 sub-slices (S1–S4 de x00048, correspondientes a
    S6.a, S6.c, S6.d, S6.e de a00016) están cerrados y verificados.
  - `bun run test:frameworks` + `bun run validate:examples`
    verdes, con la matriz E2E de 8/8 patrones (los 6 multi-estilo
    ya cerrados + los 2 nuevos: alias canonicalisation y
    constant bindings reales).
  - `a00016` sigue marcado `done`; su body se actualiza (sólo
    el texto descriptivo, no el frontmatter) para apuntar a
    x00048 como el lugar donde vive el trabajo restante.
  - El scanner de NestJS consume `LanguageIR` igual que
    `express.scanner.ts` desde a00016 S5.
slices:
  - sliceId: S1
    title: "feat(language-ir): IImportBinding.importedName + alias canonicalisation"
    files:
      - packages/contracts/interfaces/core/language-ir.interface.ts
      - packages/frameworks/typescript/symbol-resolver.helper.ts
      - tests/frameworks/symbol-resolver.spec.ts
    gate: type
    dependsOn: []
    acceptance:
      - `IImportBinding` añade `importedName: string` además de
        `name` (que era el alias local).
      - El collector en `symbol-resolver.helper.ts:228` ya
        destructura `local + imported`; ahora guarda ambos.
      - `import { Router as R } from 'express'` resuelve
        `R → Router` (antes: `R → R`).
      - Test focalizado: `import { Router as R } from 'express'; R.get('/x', h)`
        produce `IRouteCallExpression { receiver: 'Router', method: 'get', ... }`.
      - `bun run test:frameworks` verde.
    notes: |
      Era `a00016` S6.a. Size: S (2–3 h).
      **Status: done (9429895).** Contrato + collector + 2 tests
      (R→Router, default/namespace/named).
  - sliceId: S2
    title: "feat(language-ir): collect-constants.helper.ts + wiring real en express.scanner"
    files:
      - packages/frameworks/typescript/collect-constants.helper.ts (nuevo)
      - packages/frameworks/scanners/express.scanner.ts
      - tests/frameworks/constant-propagation.spec.ts
      - tests/frameworks/express-multi-style.spec.ts
    gate: type
    dependsOn: [S1]
    acceptance:
      - Walker Babel AST de `VariableDeclarator` con `init` literal.
      - Emite `IConstantBinding[]` con `{ name, value, range }`.
      - `express.scanner.ts:282-283` pasa los bindings reales a
        `propagateConstants(irCalls, bindings)` (hoy pasa `[]`).
      - Caso `const M = "get"; app[M]("/h", h)` → `GET /h`.
      - Sólo strings literales directos (no concatenación, no
        template literals con `${}` — esa es la heurística
        documentada en a00016).
      - `bun run test:frameworks` verde.
    notes: |
      Era `a00016` S6.c. Size: M (4–6 h).
      **Status: done (9429895).** El wiring ya existía
      (collectConstantsFromSource en express.scanner); el slice
      cerró los 2 tests E2E que fijan `const M="get"` /
      `const M="post"` en express-multi-style.spec.ts.
  - sliceId: S3
    title: "feat(language-ir): build-language-ir.helper.ts single-parse (parsear una vez por archivo, no por scanner)"
    files:
      - packages/frameworks/typescript/build-language-ir.helper.ts (nuevo)
      - packages/frameworks/scanners/express.scanner.ts
      - packages/frameworks/scanners/nestjs.scanner.ts (preparación para S4)
      - packages/frameworks/scanners/hono.scanner.ts
      - packages/frameworks/scanners/fastify.scanner.ts
      - tests/frameworks/build-language-ir.spec.ts (nuevo)
    gate: type
    dependsOn: [S1, S2]
    acceptance:
      - El helper toma una ruta de archivo y devuelve
        `ILanguageIR` (calls + bindings + imports + constants).
      - Cada scanner TS-flavored consume el helper en vez de
        re-parsear el AST con su propio walker.
      - Test focalizado: el AST se parsea una sola vez por
        archivo (instrumentar con un spy o contar llamadas
        a `parse()`).
      - `bun run test:frameworks` verde.
    notes: |
      Era `a00016` S6.d. Size: M (4–6 h). Reduce el coste de
      scan cuando un proyecto activa varios frameworks TS.
      **Status: done (4a3b4d7).** parseModuleWithProgram en el
      frontend + buildLanguageIRFromProgram; Express migrado a
      1 parse/archivo (antes 3). Test con spy sobre @babel/parser
      verifica 1 llamada en el scan E2E. Hono/Fastify/Next/tRPC
      no tocan Babel (regex helpers propios) — no hay parses
      redundantes que consolidar ahí; el scope real de S3 es
      Express, y está cerrado.
  - sliceId: S4
    title: "feat(scanner): NestJS consume LanguageIR (cierra la matriz E2E)"
    files:
      - packages/frameworks/scanners/nestjs.scanner.ts
      - tests/frameworks/nestjs-multi-style.spec.ts (nuevo)
    gate: type
    dependsOn: [S3]
    acceptance:
      - `nestjs.scanner.ts` consume `ILanguageIR` igual que
        `express.scanner.ts` desde a00016 S5.
      - Los 6 multi-estilos + 2 nuevos (alias + constants) producen
        los mismos endpoints en `example-nestjs/`.
      - `bun run validate:examples` verde.
    notes: |
      Era `a00016` S6.e. Size: M (3–4 h).
      **Status: done (180050a).** nestjs.scanner consume
      parseModule() + routesFromDecorators(ast.decorators) con
      fallback regex si el parse falla. 5 tests multi-estilo
      nuevos (verbo multi-línea, @Controller objeto multi-línea,
      orden top-down, decorador comentado, fichero roto no rompe
      el scan). validate:examples 21/21 (example-nestjs 7
      endpoints intactos).
---

# x00048 — a00016 S6 LanguageIR completo

## Contexto

`a00016` está marcado `done` desde 2026-09-04. Su propio body
reconoce 4 sub-slices pendientes (S6.a, S6.c, S6.d, S6.e). El
auditor 2026-09-05 señaló la contradicción:

> `frontmatter: done / folder: done/ / body: pending` — no
> aceptar su cierre tal como está.

Recomendó extraer el trabajo restante a propuestas independientes.

## Decisión

No reabro `a00016`. El universal §4 dice
> Archived proposals are frozen. must not be transitioned, edited,
> or have their slice statuses changed.

Y x00032 (lint:proposals) garantiza que un `done` no tiene slices
pending dentro. Las dos reglas juntas dicen que la salida es
**extraer**, no reabrir.

x00048 recoge los 4 sub-slices como sus propios slices (S1–S4 de
x00048). Cuando x00048 se archive, `a00016` sigue `done`; su body
se actualiza (sólo texto descriptivo, no frontmatter) para apuntar
a x00048 como el lugar donde vive el trabajo restante.

## Diseño de los slices

Ver `slices:` en el frontmatter. Cada slice corresponde a un
sub-slice de a00016 S6 (mapeo en `notes:`).

### S1 — IImportBinding.importedName

Cambio mínimo en el contrato + collector ya destructuraba. El
test verifica el caso `R → Router` (antes era `R → R`).

### S2 — collect-constants.helper.ts

Walker Babel. wiring en `express.scanner.ts`. Caso E2E añadido a
`express-multi-style.spec.ts`. Cierra el patrón 8 de la matriz
E2E de a00016.

### S3 — build-language-ir.helper.ts single-parse

Hoy cada scanner TS-flavored re-parsea el AST con su propio
walker. Single-parse reduce el coste cuando hay varios frameworks
TS activos. Es la mitad de "AST parsing motor" que p00030
(r00008 ahora `done`) dejaba para después.

### S4 — NestJS consume LanguageIR

Cierra la matriz E2E. Después de S4, los 4 scanners TS-flavored
(express, nestjs, hono, fastify) comparten el mismo frontend.

## Por qué va antes que x00049 (integration verifier)

x00049 es arquitectural (gate post-merge). x00048 es trabajo
técnico concreto (LanguageIR). Si los agentes paralelos tocan
scanners TS antes de que x00048 cierre, van a chocar con el
contrato a medio actualizar. Mejor cerrar x00048 primero y
después blindar con x00049.