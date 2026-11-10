---
id: c00007
title: "prohibir sync_proposals automático en Tanit"
kind: chore
status: done
type: proposal
track: general
date: 2026-09-06
last-transition-id: c00007-done
shippedIn:
  - eb6981c
last-correlation-id: affair-2026-09-06-c00007-done
last-transition-from: review
last-idempotency-key: affair-2026-09-06-c00007-done
---

# c00007 — prohibir sync_proposals automático en Tanit

## Goal

sync_proposals ha causado churn reciente en Tanit. Mientras se arregla en Delendai, Tanit debe usar gen-index + lint:proposals como fuente de verdad.

## why

El último bloque de commits tuvo que restaurar manualmente propuestas porque sync_proposals las movió a carpetas incorrectas. El filename builder duplica el ID cuando el título empieza por xNNNNN.

## non-goals

- Tocar el tooling `sync_proposals` (deuda del sibling `@delendai/core`).
- Reemplazar `gen-index.script.ts` por algo distinto — sigue siendo la fuente de verdad.

## Slices

- global_gate: none

### S1 — chore: documentar la prohibición en CONTRIBUTING
- **Status**: done
- **Files**: `CONTRIBUTING.md`
- **Gate**: lint
- acceptance:
  - "CONTRIBUTING.md declara que sync_proposals NO se invoca automáticamente"
  - "Nota menciona el workaround y la fuente de verdad"
  - "El escape sigue siendo invocable manualmente si un humano lo necesita"
- review-state: done
- review-implementer: orchestrator
- review-reviewer: delivery-verifier
- review-log: approved by delivery-verifier — Single-agent auto-review. eb6981c añade nota en CONTRIBUTING.md declarando que sync_proposals no se invoca automáticamente; menciona gen-index + lint:proposals como fuente de verdad; escape manual sigue disponible. Validate pasa 3216/3216.
## acceptance

- CONTRIBUTING.md declara que sync_proposals NO se invoca automáticamente
- Nota menciona el workaround y la fuente de verdad
- El escape sigue siendo invocable manualmente si un humano lo necesita
