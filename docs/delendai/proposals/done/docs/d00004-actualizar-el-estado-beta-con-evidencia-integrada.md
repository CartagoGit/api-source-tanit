---
id: d00004
title: "Actualizar el estado beta con evidencia integrada"
kind: docs
status: done
type: proposal
track: general
date: 2026-11-19
last-transition-id: ccd7dc1c-20de-4a3f-ac43-cca74aa6b605
last-correlation-id: ccd7dc1c-20de-4a3f-ac43-cca74aa6b605
last-transition-from: review
last-transition-at: 2026-11-19T15:25:45.030Z
shipped-in:
  - "7d210128a81474bf50f67be1229aff6b42721b09"
---

# d00004 — Actualizar el estado beta con evidencia integrada

## goal

Registrar evidencia técnica actual y distinguir aceptación humana y escritorio firmado pendientes.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: lint

### S1 — Actualizar evidencia y límites beta
- **Status**: done
- **Files**: `docs/BETA.md`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: none
- acceptance:
  - "Registrar corpus, interfaz y CI verificados sin afirmar aceptación humana ni escritorio firmado."
  - "Conservar trabajo remoto y bloqueos pendientes."
- shipped-in: `9aed6090fb73`
- review-state: done
- review-implementer: openai-gpt-6.1-terra
- review-reviewer: openai-gpt-6.1-sol
- review-log: approved by openai-gpt-6.1-sol — verified at 7d210128a814, validate exit 0 and tests 15/15 claimed, no recorded run cited; acceptance 2/2: (1) docs/BETA.md de 7d210128 evidencia integrada, límites y pendientes explícitos; diff 9aed6090 y 8c5561f4; CI exacta 44481145508 success. (2) docs/BETA.md de 7d210128 evidencia integrada, límites y pendientes explícitos; diff 9aed6090 y 8c5561f4; CI exacta 44481145508 success. — Revisados 9aed6090, 8c5561f4 y entrega #180 7d210128. docs/BETA distingue corpus method/path 20/20 y 21/21 y comprobación Chromium de evaluación humana pendiente. Mantiene S6 pendiente, f00021 bloqueado, GLib y desktop firmado pendientes; ninguna release declarada. CI exacta https://github.com/CartagoGit/api-source-tanit/actions/runs/44481145508 success; 15/15 son el subgrupo SQLite observado en log, conteos citados de CI, no ejecución local ni total global. Gate none. Bootstrap cambiado después por 28681249,5567e815,99a2a59a,717ee23b sin invalidar BETA.

## acceptance

- Registrar corpus, interfaz y CI verificados sin afirmar aceptación humana ni escritorio firmado.
- Conservar trabajo remoto y bloqueos pendientes.
