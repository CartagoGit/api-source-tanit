---
id: x00072
title: "Los ejemplos y la fixture de tRPC siguen en zod v3 con una vulnerabilidad alta abierta"
kind: fix
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-01
shippedIn:
  - 794d26b
shipped-in: ["794d26b"]
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
| `examples/example-hono/package.json` | `zod ^3.23.0` | `@hono/zod-validator` sólo declara `\|\| ^4.0.0` desde la 0.9.0 |
| `examples/example-trpc/package.json` | `zod ^3.22.0` | `@trpc/server` v10 está en su última línea; v11 es la que acompaña a zod v4 |
| `tests/smoke-fixtures/trpc-mini/package.json` | `zod ^3.22.0` | ídem que el ejemplo de tRPC |

> **Corrección (2026-11-01, revisión independiente).** La primera
> versión de esta tabla decía que "`@trpc/server` v10 exige zod v3" y
> que "`@hono/zod-validator` necesita `^0.5+`". Ninguna de las dos
> cosas es cierta: v10.45.0 y v11.x **no declaran** a zod como peer
> (v11 sólo pide `typescript >= 5.7.2`) y de hecho v10.45.0 con zod
> 4.6.7 funciona; y el `|| ^4.0.0` apareció en `@hono/zod-validator`
> **0.9.0**, no en la 0.5. Las versiones elegidas siguen siendo las
> correctas —la v10 está en su última línea y la 0.9 es la primera que
> admite zod v4— pero el porqué no se sostenía.

El paquete de la raíz ya usa `zod ^4.6.7`: la herramienta que se
publica no está afectada. Lo que queda en v3 son los **ejemplos** —lo
que alguien copia para empezar su API— y una fixture de humo.

## Lo que la revisión encontró y cambió

- **F1/F2 (LOW)**: las justificaciones de arriba, corregidas.
- **F3 (MEDIUM)**: las cinco alertas de Dependabot siguen **abiertas**
  hasta que `develop` se promueva a `main`, que es la rama por defecto
  del repo y la que Dependabot lee. Los manifiestos ya no piden una
  versión vulnerable; el cierre de las alertas ocurre al publicar.
- **F4 (LOW)**: tres fixtures hermanas (`tests/fixtures/hono-comprehensive`,
  `nextjs-comprehensive`, `trpc-comprehensive`) seguían en zod v3. El
  repo llevaba dos generaciones de zod; ahora lleva una.
- **F5 (LOW)**: `@hono/zod-validator@0.9.1` exige `hono >= 4.11.2` y
  el ejemplo declaraba `hono ^4.6.0`: un suelo declarado por debajo
  del suelo que exige el peer.

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
- **Status**: done
- **DependsOn**: []
- **Files**: `examples/example-express/package.json`, `examples/example-nextjs/package.json`, `examples/example-hono/package.json`, `examples/example-trpc/package.json`, `tests/smoke-fixtures/trpc-mini/package.json`, `tests/fixtures/hono-comprehensive/package.json`, `tests/fixtures/nextjs-comprehensive/package.json`, `tests/fixtures/trpc-comprehensive/package.json`
- **Gate**: e2e
- acceptance:
  - "Los cinco manifiestos piden `zod ^4.6.7` (o superior)"
  - "`@trpc/server` sube a `^11` en el ejemplo, en la fixture y en la fixture comprehensiva: la v10 está en su última línea"
  - "`@hono/zod-validator` sube a `^0.9.1`, la primera versión que declara `zod ^3.25.0 || ^4.0.0`"
  - "`hono` sube a `^4.11.2` en el ejemplo y en la fixture, que es el suelo que pide el peer del validador"
  - "El código de los ejemplos no usa APIs que cambian entre v3 y v4 (`z.object`, `z.string`, `z.number`, `z.enum`, `z.array` y `z.coerce.number` se comportan igual)"
  - "La colección esperada de la fixture no cambia: el mismo código produce la misma detección"
  - "Ningún manifiesto del repo pide ya una versión vulnerable de zod; las cinco alertas de Dependabot quedan cerradas al promover `develop` a `main`, la rama por defecto desde la que Dependabot construye el grafo"
  - "DoD slice: `bun run typecheck && bun run test && bun run validate:examples` verdes"
- review-state: done
- review-implementer: minimax-m3
- review-reviewer: delivery-verifier
- review-log: approved by delivery-verifier — Veredicto **approved** sobre el diff de `794d26b` (PR #54). Comprobado ejecutando de verdad los cuatro ejemplos con zod 4.6.7 / trpc 11.22.1 / validator 0.9.1 / hono 4.13.16: `example-express` arranca y sirve (`GET /api/users?page=2` devuelve `{"page":2,"limit":20}`, el `z.coerce` funciona, el `role` por defecto sale `"user"` y un cuerpo inválido da `ZodError`); `example-hono` acepta el `zValidator` de dos argumentos (válido 200/201, inválido 400); `example-trpc` acepta `input(zod4)` y devuelve `TRPCError` en lo inválido, y `.subscription()` sigue existiendo en v11; `example-nextjs` parsea bien. `.email()` y `.uuid()`, deprecados en v4, siguen funcionando. Gates: `validate:examples` 25/25, `lint:proposals` 167 sin drift, `bun audit` de la raíz sin avisos de zod. Hallazgos: **F3 (MEDIUM)** las alertas siguen abiertas hasta promover `develop` a `main`; **F1/F2 (LOW)** las justificaciones de `@trpc/server` y `@hono/zod-validator` eran falsas y se corrigen en esta ronda; **F4 (LOW)** tres fixtures hermanas seguían en zod v3 y se suben; **F5 (LOW)** el suelo de `hono` quedaba por debajo del peer; **F6 (LOW)** el peer `typescript` de trpc v11 hace que npm auto-instale typescript en ejemplos sin tsconfig — se acepta como ruido; **F7 (INFO)** ningún gate cubre el zod de los ejemplos (el typecheck sólo incluye `packages/**`, `scripts/**`, `tests/**` y `examples/example-app/**`), así que la evidencia de "el código sigue siendo válido con zod v4" es del revisor, no de un gate; **F8/F9 (INFO)** fallos preexistentes ajenos a este cambio.
