---
id: x00035
title: "Package manager detection - bun.lock también admitido (bun.lockb como fallback legacy)"
kind: fix
status: ready
type: proposal
track: general
date: 2026-09-05
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

- **Status**: pending
- **Files**: `packages/frameworks/scanners/express.scanner.ts`, `packages/frameworks/scanners/fastify.scanner.ts`, `packages/frameworks/scanners/graphql.scanner.ts`, `packages/frameworks/scanners/hono.scanner.ts`, `packages/frameworks/scanners/nestjs.scanner.ts`, `packages/frameworks/scanners/nextjs.scanner.ts`, `packages/frameworks/scanners/trpc.scanner.ts`
- **Gate**: type
- **Acceptance**: Cada scanner acepta `bun.lock` (peso 0.15) Y `bun.lockb` (peso 0.15). Si ambos existen (caso degenerado), se acepta `bun.lock` con peso 0.15 y se ignora `bun.lockb`.

### S2 — Tests: cada scanner distingue bun.lock de bun.lockb

- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `tests/frameworks/express-scanner.spec.ts`, `tests/frameworks/fastify-scanner.spec.ts`, `tests/frameworks/graphql-scanner.spec.ts`, `tests/frameworks/hono-scanner.spec.ts`, `tests/frameworks/nestjs-scanner.spec.ts`, `tests/frameworks/nextjs-scanner.spec.ts`, `tests/frameworks/trpc-scanner.spec.ts`
- **Gate**: lint

### S3 — Fixture smoke: monorepo Bun moderno (solo bun.lock)

- **Status**: pending
- **DependsOn**: [S2]
- **Files**: `tests/smoke-fixtures/bun-modern-mini/`
- **Gate**: e2e

## Acceptance

- Los 7 scanners pasan el test "bun.lock presente → evidence con weight 0.15".
- Los 7 scanners siguen pasando el test "bun.lockb presente → evidence con weight 0.15" (no regresión).
- El linter `bun run lint` no se queja de la nueva rama.
- `bun run validate` verde.
