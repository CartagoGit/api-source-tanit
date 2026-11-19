---
id: x00111
title: "Arranque autónomo de UI en binario compilado"
kind: fix
status: in-progress
type: proposal
track: general
date: 2026-11-19
last-transition-id: 6c7edc58-3d39-49ab-a379-ed675832cbe5
last-correlation-id: 6c7edc58-3d39-49ab-a379-ed675832cbe5
last-transition-from: ready
last-transition-at: 2026-11-19T15:04:06.854Z
---

# x00111 — Arranque autónomo de UI en binario compilado

## goal

Permitir que apisrc ui arranque fuera del repositorio y respete el directorio estático explícito.

## why

El helper de scripts falla al buscar la raíz dentro del sistema virtual del binario.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — Resolver assets sin depender del árbol del repositorio
- **Status**: pending
- **Files**: `packages/cli/commands/ui.script.ts`, `tests/cli/compiled-binary.test.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: none
- acceptance:
  - "El binario arranca con UI integrada fuera del repositorio."
  - "El binario sirve un directorio estático explícito."
  - "La autodetección en checkout sigue funcionando."

## acceptance

- El binario arranca con UI integrada fuera del repositorio.
- El binario sirve un directorio estático explícito.
- La autodetección en checkout sigue funcionando.
