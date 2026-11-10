---
id: x00098
title: "Ignorar inicializadores nulos del AST sin abortar el análisis de proyectos TypeScript"
kind: fix
status: ready
type: proposal
track: language-ir
date: 2026-11-10
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
- **Status**: pending
- **Files**: `packages/core/language-ir/collect-constants.helper.ts`, `tests/frameworks/collect-constants.spec.ts`, `tests/frameworks/build-language-ir.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Declaraciones declare const/export declare const sin init no provocan TypeError ni generan constantes inventadas."
  - "Mantener constantes literales y rutas que siguen a declaraciones ambientales; cubrir tanto entrada source como Program AST."
  - "Repetir análisis estático del repositorio externo fijado sin instalar dependencias ni ejecutar su código y registrar limitaciones por separado."

## acceptance

- Declaraciones declare const/export declare const sin init no provocan TypeError ni generan constantes inventadas.
- Mantener constantes literales y rutas que siguen a declaraciones ambientales; cubrir tanto entrada source como Program AST.
- Repetir análisis estático del repositorio externo fijado sin instalar dependencias ni ejecutar su código y registrar limitaciones por separado.
