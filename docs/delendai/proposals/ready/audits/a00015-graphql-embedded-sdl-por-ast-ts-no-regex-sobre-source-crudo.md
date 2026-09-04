---
id: a00015
title: "GraphQL embedded SDL por AST TS (no regex sobre source crudo)"
kind: audit
status: ready
type: proposal
track: export-to-postman
date: 2026-09-04
shippedIn:
  - fcff35c  # S1: taggedTemplates shape en frontend TS + 8 tests
  - 71b535c  # S2: adapter AST-based replaces regex
  - 1e5c339  # S3: eliminar regex sobre source crudo
  - 7080255  # merge into develop + push
dependsOn:
  - a00012
related:
  - a00009
  - f00010
---

# a00015 — GraphQL embedded SDL por AST TS

> **Revisión 2026-09-05 (cierre reabierto — hallazgo abierto, slice S4 añadido).**
> El cambio AST (Babel `TaggedTemplateExpression`) es correcto y es la dirección
> que el proyecto necesitaba. Pero la extracción del `raw` tiene un hueco que las
> revisiones de rama señalan y que el código confirma
> (`packages/frameworks/typescript/tagged-template.ts:190-203`):
>
> ```ts
> const raw = quasis.map((elem) => …value.raw…).join("");
> ```
>
> `.join("")` concatena **solo los quasis** y descarta las `expressions` del
> template. Un `gql\`${userTypes} type Query { … }\`` pierde `${userTypes}` en
> silencio — caso común en composición de schemas/fragments GraphQL. El contrato
> de `ITaggedTemplate.raw` dice que el texto conserva `${…}`, y el adaptador afirma
> conservar el crudo: implementación y contrato se contradicen.
>
> No bloquea el cierre del AST-migration, pero **impide cerrar a00015
> completamente**: añadir S4 (diagnóstico/sentinel de interpolaciones) antes de
> `done`.

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

### S4 — Interpolaciones: diagnóstico o sentinel (correctivo, pendiente)

- **Status**: pending
- **Files**:
  - `packages/frameworks/typescript/tagged-template.ts`
  - `packages/frameworks/scanners/graphql-embedded.adapter.ts`
  - `tests/frameworks/graphql-embedded-adapter.spec.ts` (o el spec del frontend)
- **Gate**: `bun run test:frameworks`
- **Detalle** (elegir una, documentada):
  - (A) Preservar un sentinel por interpolación: `__TANIT_INTERP_0__` en el lugar
    de cada `${…}`, para que el parser SDL no rompa y el origen quede visible.
  - (B) Emitir un `diagnostic` ("unresolved GraphQL template interpolation") cuando
    `expressions.length > 0` y conservar el template con sentinel.
  - (C) Si el nombre del binding de la interpolación es resoluble con el
    `symbol-resolver` (a16), expandir estáticamente. Preferir B (más barato, honesto)
    y dejar C para el IR de a00016.
  - **Test nuevo adversarial**: `gql\`${shared} type Query { foo: String }\`` →
    aserta que (i) la operación `Query.foo` se detecta igual, y (ii) existe un
    diagnóstico/sentinel sobre `${shared}`. Los tests actuales **no cubren** este
    caso; por eso el hueco pasó.

## acceptance

1. Tres fixtures (positivo / negativo / string-falso-positivo)
   pasan tests.
2. Cero falsos positivos en comentarios y strings.
3. Coverage del scanner GraphQL ≥ 90% (Statements).
4. bun run validate verde.
5. **(S4) Un template con `${…}` produce diagnóstico/sentinel visible, no una SDL
   que borre silenciosamente la interpolación.**
