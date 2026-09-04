---
id: a00015
title: "GraphQL embedded SDL por AST TS (no regex sobre source crudo)"
kind: audit
status: ready
type: proposal
track: export-to-postman
date: 2026-09-04
dependsOn:
  - a00012
related:
  - a00009
  - f00010
---

# a00015 — GraphQL embedded SDL por AST TS

## Goal

Sustituir la extracción textual (regex contra source crudo) del
scanner GraphQL por una consulta al AST TypeScript del proyecto.
Se reutiliza el frontend TS existente y se le pide que exponga
taggedTemplates con shape estable.

## Why

El solver actual dispara falsos positivos:

- comentarios con código de ejemplo,
- help texts tipo "Puedes escribir gql`type Query { fake: String }`",
- cualquier cadena que contenga la secuencia literal.

El proyecto ya tiene un frontend TS capaz de visitar todos los
TaggedTemplateExpression y dar shape AST (member call, import
binding, source range). Reusar lo que existe evita mantener un
segundo parser.

## Non-goals

- No re-escribe el scanner GraphQL entero: solo cambia el adaptador
  de extracción embedded SDL.
- No rompe el caso .graphql/.gql: se conserva.

## Slices

### S1 — taggedTemplates shape en el frontend TS

- **Status**: pending
- **Files**:
  - packages/frameworks/typescript/tagged-template.ts (nuevo)
  - packages/frameworks/index.ts (re-export)
- **Gate**: bun run typecheck
- **Detalle**:
  - Tipo exportado con tag, raw, range, importBinding.
  - Helper collectTaggedTemplates(projectRoot) → ITaggedTemplate[].

### S2 — Adapter en scanner GraphQL

- **Status**: pending
- **Files**:
  - packages/frameworks/scanners/graphql.scanner.ts
  - packages/frameworks/scanners/graphql-embedded.adapter.ts (nuevo)
  - tests/frameworks/graphql-embedded-adapter.spec.ts (nuevo)
- **Gate**: bun run test:frameworks
- **Detalle**:
  - El scanner ya no lee source para regex; pide
    collectTaggedTemplates, filtra por tag y pasa cada raw por el
    parser SDL existente.
  - Tests positivo (gql real), negativo (comment), negativo
    (string literal), positivo (5 usos del mismo gql).

### S3 — Quitar el regex textual

- **Status**: pending
- **Files**: packages/frameworks/scanners/graphql.scanner.ts.
- **Gate**: bun run lint:regex-state
- **Detalle**: el regex de búsqueda textual deja de existir; el
  gate whitelist extiende para marcarlo como prohibido.

## acceptance

1. Tres fixtures (positivo / negativo / string-falso-positivo)
   pasan tests.
2. Cero falsos positivos en comentarios y strings.
3. Coverage del scanner GraphQL ≥ 90% (Statements).
4. bun run validate verde.
