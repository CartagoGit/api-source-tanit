---
id: x00072
title: "Los ejemplos y la fixture de tRPC siguen en zod v3 con una vulnerabilidad alta abierta"
kind: fix
status: review
type: proposal
track: api-source-tanit
date: 2026-11-01
shippedIn:
  - 794d26b
shipped-in: ["794d26b"]
last-transition-id: 7428cfc6-2a63-42f2-9c69-6b02c9af7853
last-correlation-id: 7428cfc6-2a63-42f2-9c69-6b02c9af7853
last-transition-from: in-progress
last-transition-at: 2026-11-01T05:10:41.518Z
---

# x00072 — zod v4 en los ejemplos y en la fixture de tRPC

## Goal

Cinco manifiestos del repo siguen pidiendo `zod` v3 (`^3.22.0` /
`^3.23.0`), y Dependabot tiene **cinco alertas *high* abiertas** por
lo mismo: `GHSA-mrhx-c7xc-m3w5` — "Zod can exhaust memory while
validating oversized constrained collections" — con la versión
parcheada en la **4.6.6**.

Los cinco:

| Manifiesto | Hoy | Por qué cambia |
|---|---|---|
| `examples/example-express/package.json` | `zod ^3.22.0` | — |
| `examples/example-nextjs/package.json` | `zod ^3.22.0` | — |
| `examples/example-hono/package.json` | `zod ^3.23.0` | `@hono/zod-validator` necesita `^0.5+` para zod v4 |
| `examples/example-trpc/package.json` | `zod ^3.22.0` | `@trpc/server` v10 exige zod v3; v11 admite v4 |
| `tests/smoke-fixtures/trpc-mini/package.json` | `zod ^3.22.0` | ídem que el ejemplo de tRPC |

El paquete de la raíz ya usa `zod ^4.6.7`: la herramienta que se
publica no está afectada. Lo que queda en v3 son los **ejemplos** —lo
que alguien copia para empezar su API— y una fixture de humo.

## why

- Un ejemplo con una dependencia que tiene una vulnerabilidad alta es
  un ejemplo que copia el problema. Los ejemplos son la primera
  documentación que alguien lee.
- zod v3 está en su última línea: v4 es la que se instala hoy con
  `bun add zod`. Un ejemplo en v3 enseña una API que ya no es la que
  la gente va a escribir.
- La alerta es **reproducible y visible**: la pestaña de seguridad del
  repo enseña cinco vulnerabilidades *high* mientras el gate de
  `security-audit` pasa en verde, porque el gate mira el paquete
  publicado y no los ejemplos. Dos escáneres que no se parecen es
  peor que uno solo: hace dudar del que mira.

## non-goals

- No tocar las versiones de `express`, `next`, `react` ni `hono`: no
  tienen alerta abierta.
- No reescribir los ejemplos para cambiar su API pública: sólo las
  dependencias.
- No regenerar la colección esperada de la fixture: el código fuente no
  cambia, así que la detección tampoco.

## Slices

### S1-zod-v4-en-ejemplos — S1 — zod v4 en los cinco manifiestos
- **Status**: in-progress
- **DependsOn**: []
- **Files**: `examples/example-express/package.json`, `examples/example-nextjs/package.json`, `examples/example-hono/package.json`, `examples/example-trpc/package.json`, `tests/smoke-fixtures/trpc-mini/package.json`
- **Gate**: e2e
- acceptance:
  - "Los cinco manifiestos piden `zod ^4.6.7` (o superior)"
  - "`@trpc/server` sube a `^11` en el ejemplo y en la fixture, porque la v10 exige zod v3"
  - "`@hono/zod-validator` sube a `^0.9.1`, la primera línea que admite zod v4"
  - "El código de los ejemplos no usa APIs que cambian entre v3 y v4 (`z.object`, `z.string`, `z.number`, `z.enum`, `z.array` y `z.coerce.number` se comportan igual)"
  - "La colección esperada de la fixture no cambia: el mismo código produce la misma detección"
  - "Las cinco alertas de Dependabot quedan cerradas"
  - "DoD slice: `bun run typecheck && bun run test && bun run validate:examples` verdes"
- review-state: pending
- review-implementer: minimax-m3
- review-reviewer: 
