---
id: x00098
title: "Ignorar inicializadores nulos del AST sin abortar el análisis de proyectos TypeScript"
kind: fix
status: review
type: proposal
track: language-ir
date: 2026-11-10
last-transition-id: b7bf0500-654e-4eae-97ed-0649de1972d9
last-correlation-id: b7bf0500-654e-4eae-97ed-0649de1972d9
last-transition-from: in-progress
last-transition-at: 2026-11-10T07:40:43.599Z
---

# x00098 — Ignorar inicializadores nulos del AST sin abortar el análisis de proyectos TypeScript

## goal

Analizar declaraciones ambientales sin inicializador y conservar constantes reales y rutas posteriores.

## why

Aceptación externa 2026-11-10: binario Linux aborta en unwrapTSAsExpression al analizar declare const global en gothinkster/node-express-realworld-example-app, commit 30b68e1e881462b2f4164ea09ab4c4f5699c7b0b. Babel representa init ausente con null, pero el collector solo excluye undefined.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — Respetar nulabilidad de VariableDeclarator.init
- **Status**: review
- **Files**: `packages/core/language-ir/collect-constants.helper.ts`, `tests/frameworks/collect-constants.spec.ts`, `tests/frameworks/build-language-ir.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Declaraciones declare const/export declare const sin init no provocan TypeError ni generan constantes inventadas."
  - "Mantener constantes literales y rutas que siguen a declaraciones ambientales; cubrir tanto entrada source como Program AST."
  - "Repetir análisis estático del repositorio externo fijado sin instalar dependencias ni ejecutar su código y registrar limitaciones por separado."
- shipped-in: `e34de9650e4f`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

## acceptance

- Declaraciones declare const/export declare const sin init no provocan TypeError ni generan constantes inventadas.
- Mantener constantes literales y rutas que siguen a declaraciones ambientales; cubrir tanto entrada source como Program AST.
- Repetir análisis estático del repositorio externo fijado sin instalar dependencias ni ejecutar su código y registrar limitaciones por separado.


## External acceptance evidence — 2026-11-10

Public repository: `gothinkster/node-express-realworld-example-app`,
immutable revision `30b68e1e881462b2f4164ea09ab4c4f5699c7b0b`.
Only static analysis was performed: no dependency installation, server,
migration or project script execution. Third-party source is not vendored.

The prior standalone Linux binary aborted with a null-node TypeError while
collecting constants from `src/prisma/prisma-client.ts`. Three new regressions
failed with that same TypeError before the fix; the focused constants/IR/
propagation suite now passes 27/27. The corrected source CLI and a newly
compiled Linux binary both finish with Express / 20 indexed operations;
the binary also runs with only system tools on PATH.

This proves crash recovery, not endpoint accuracy. Manual inspection found
that 19 controller routes are mounted under `/api` by a chained router export,
while the generated paths currently omit that prefix. The root `GET /` is
separate. This discovery is a subsequent scanner defect and must not be
counted as successful contract acceptance or a 100% precision/recall result.
Response/schema correctness and Application API parity remain unmeasured
for this external sample.
