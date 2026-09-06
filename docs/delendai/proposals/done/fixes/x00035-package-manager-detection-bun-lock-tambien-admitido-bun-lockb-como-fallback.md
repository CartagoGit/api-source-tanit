---
id: x00035
title: "Package manager detection - bun.lock también admitido (bun.lockb como fallback legacy)"
kind: fix
status: done
type: proposal
track: general
date: 2026-09-05
shippedIn:
  - 2c01974  # S1: bun.lock texto admitido en los 7 scanners (Bun ≥ 1.2)
  - cf2b319  # S2 + S3: tests para bun.lock + smoke fixture bun-modern-mini
---

# x00035 — Package manager detection: bun.lock también admitido

## Goal

Hacer que los detectores de los 7 frameworks TypeScript/JavaScript
(express, fastify, graphql, hono, nestjs, nextjs, trpc) acepten tanto
`bun.lock` (formato actual que produce Bun ≥ 1.2) como `bun.lockb`
(formato binario legacy que produce Bun < 1.2) al refinar la detección
del framework. Hoy solo se comprueba `bun.lockb`, así que un proyecto
moderno en Bun refina con menos evidencia de la que podría.

## Why

El propio repositorio usa `bun.lock` (texto) y los tests están escritos
contra ese formato. Pero los 7 detectores en `packages/frameworks/scanners/`
únicamente ejecutan:

```ts
if (existsSync(join(projectRoot, "bun.lockb"))) {
  out.push({ signal: "bun.lockb presente", weight: 0.15, artifact: "bun.lockb" });
}
```

Resultado: un usuario con `bun.lock` (la mayoría hoy) **no recibe** esa
señal y la confidence del framework queda más baja de lo que merece.
Bug menor confirmado, no afecta al flag "found", sí a la calidad de
evidence.

Los siete ficheros son esencialmente la misma comprobación copiada
(`f00011 S4: bun.lockb` aparece como comentario en todos), lo que
reforza la urgencia de centralizar la detección de package manager
(este slice hace el centralizado-mínimo, en slices posteriores se
generalizará).

## Non-goals

- No refactoriza los 7 scanners para que llamen a un helper compartido.
  Eso es un slice posterior (S4) que requiere decidir la forma del
  helper centralizado.
- No añade nuevos package managers (pnpm, yarn, npm) — esos ya tienen
  su propia rama de detección en cada scanner.
- No cambia el peso de la evidencia (0.15). Eso es una decisión de
  calibración para otro slice.

## Slices

- global_gate: lint

### S1 — Detección robusta de bun.lock || bun.lockb en los 7 scanners

- **Status**: done
- **Files**: `packages/frameworks/scanners/express.scanner.ts`, `packages/frameworks/scanners/fastify.scanner.ts`, `packages/frameworks/scanners/graphql.scanner.ts`, `packages/frameworks/scanners/hono.scanner.ts`, `packages/frameworks/scanners/nestjs.scanner.ts`, `packages/frameworks/scanners/nextjs.scanner.ts`, `packages/frameworks/scanners/trpc.scanner.ts`
- **Gate**: type
- **Detalle (2c01974)**: cada scanner tiene el patrón `if (bun.lock) → push(weight: 0.15); else if (bun.lockb) → push(weight: 0.15)`. Si ambos existen, gana `bun.lock` y `bun.lockb` se ignora.

### S2 — Tests: cada scanner distingue bun.lock de bun.lockb

- **Status**: done
- **DependsOn**: [S1]
- **Files**: `tests/frameworks/{express,fastify,graphql-trpc,hono,nestjs,nextjs}-scanner.spec.ts`
- **Gate**: lint
- **Detalle (cf2b319)**: nuevo describe block en cada spec con dos tests:
  * `bun.lock (text) adds evidence with weight 0.15` (y `bun.lockb NO` aparece).
  * `when both bun.lock and bun.lockb exist, bun.lock wins and bun.lockb is ignored`.
  GraphQL y tRPC comparten `graphql-trpc.spec.ts`, así que cada uno gana su propio describe block ahí.

### S3 — Fixture smoke: monorepo Bun moderno (solo bun.lock)

- **Status**: done
- **DependsOn**: [S2]
- **Files**: `tests/smoke-fixtures/bun-modern-mini/`
- **Gate**: e2e
- **Detalle (cf2b319)**: `tests/smoke-fixtures/bun-modern-mini/` con `package.json` + `server.js` idénticos a `express-mini` (5 endpoints) más un `bun.lock` textual. `expected.json` lista los 5 endpoints y un campo `_x00035` documentando el signal esperado (`bun.lock`, weight 0.15).

## Acceptance

- Los 7 scanners pasan el test "bun.lock presente → evidence con weight 0.15". ✅
- Los 7 scanners siguen pasando el test "bun.lockb presente → evidence con weight 0.15" (no regresión). ✅
- El linter `bun run lint` no se queja de la nueva rama. ✅
- `bun run validate` verde localmente. ✅ (CI queda pendiente hasta que x00027 cierre.)
