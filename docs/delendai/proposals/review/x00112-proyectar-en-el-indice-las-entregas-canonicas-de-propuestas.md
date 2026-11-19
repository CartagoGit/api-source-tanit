---
id: x00112
title: "Proyectar en el índice las entregas canónicas de propuestas"
kind: fix
status: review
type: proposal
track: workflow
date: 2026-11-19
last-transition-id: a1804d55-3900-49e5-8dfa-18a5f11cf90f
last-correlation-id: a1804d55-3900-49e5-8dfa-18a5f11cf90f
last-transition-from: in-progress
last-transition-at: 2026-11-19T15:16:23.886Z
---

# x00112 — Proyectar en el índice las entregas canónicas de propuestas

## goal

Mostrar los SHAs que DelendAI registra al cerrar propuestas y compartir la lectura con la validación.

## why

El generador del índice solo lee shippedIn y muestra un guion incluso cuando la evidencia shipped-in es válida.

## non-goals

- Cambiar los SHAs registrados o las reglas de validación de DelendAI.

## slices

- global_gate: lint

### S1 — Compartir la lectura de los SHAs entre el índice y el lint
- **Status**: review
- **Files**: `scripts/helpers/proposal-frontmatter.helper.ts`, `scripts/gates/gen-index.script.ts`, `scripts/gates/lint-proposals.script.ts`, `tests/scripts-gates/proposal-frontmatter.spec.ts`, `docs/delendai/proposals/INDEX.md`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: lint
- acceptance:
  - "El índice generado incluye los SHAs de shipped-in canónico y de shippedIn histórico usando el mismo lector que el lint."
  - "El índice canónico se puede comprobar byte por byte y conserva todas las evidencias históricas alcanzables."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `a52ed4a09e1f`

## acceptance

- El índice generado incluye los SHAs de shipped-in canónico y de shippedIn histórico usando el mismo lector que el lint.
- El índice canónico se puede comprobar byte por byte y conserva todas las evidencias históricas alcanzables.
