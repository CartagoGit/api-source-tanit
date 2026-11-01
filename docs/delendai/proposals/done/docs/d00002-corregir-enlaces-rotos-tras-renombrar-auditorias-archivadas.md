---
id: d00002
title: "Corregir enlaces rotos tras renombrar auditorías archivadas"
kind: docs
status: done
type: proposal
track: general
date: 2026-08-30
last-transition-id: 4a2df735-272e-4bfa-80a9-1998b55166af
last-correlation-id: 4a2df735-272e-4bfa-80a9-1998b55166af
last-transition-from: in-progress
shippedIn:
  - 52042da  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

# d00002 — Corregir enlaces rotos tras renombrar auditorías archivadas

## Goal

Mantener navegables las referencias a propuestas archivadas después de que sus
ficheros hayan sido renombrados por el sistema de propuestas.

## Why

`bun run validate` fallaba en `lint:docs` porque `.github/agents.md` apuntaba a
una ruta antigua de `a00003`. El índice también conservaba rutas obsoletas para
`a00007` y `a00008`, dejando inconsistentes el registro y la navegación.

## Non-goals

- No renombrar propuestas archivadas.
- No modificar el contenido histórico de las auditorías.
- No corregir enlaces ajenos a las propuestas auditadas.

## Slices

- global_gate: none

### S1 — Referencias archivadas
- **Status**: done
- **Files**: `.github/agents.md`, `docs/delendai/proposals/INDEX.md`
- **Gate**: `bun run lint:docs && bun run lint:proposals`
- **Result**: Actualizadas las rutas de `a00003`, `a00007` y `a00008` a sus
	nombres canónicos actuales.
- review-state: done
- review-implementer: orchestrator
- review-reviewer: delivery-verifier
- review-log: approved by delivery-verifier — Revisión independiente aprobada: las rutas a a00003, a00007 y a00008 existen; lint:docs y lint:proposals pasan.
## acceptance

- `bun run lint:docs` termina con código 0.
- `bun run lint:proposals` termina con código 0.
- Las referencias de `a00003`, `a00007` y `a00008` apuntan a ficheros existentes.
