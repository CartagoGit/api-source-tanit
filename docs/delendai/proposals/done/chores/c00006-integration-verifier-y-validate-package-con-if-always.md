---
id: c00006
title: "integration verifier y validate package con if always"
kind: chore
status: done
type: proposal
track: general
date: 2026-09-06
last-transition-id: c00006-done
shippedIn:
  - 9afed13
last-correlation-id: affair-2026-09-06-c00006-done
last-transition-from: review
last-idempotency-key: affair-2026-09-06-c00006-done
---

# c00006 — integration verifier y validate package con if always

## Goal

Poner if always() en los steps Integration verifier y Validate package de validate.yml para que produzcan diagnóstico aunque Validate falle.

## why

GitHub Actions salta los steps posteriores cuando uno falla. El step Integration verifier está pensado para diagnosticar precisamente cuando algo falla, pero se salta precisamente cuando algo falla.

## non-goals

- Tocar el resto del workflow `validate.yml` (solo los dos steps post-Validate).
- Cambiar la lógica del integration verifier — solo el `if: ${{ always() }}`.

## Slices

- global_gate: none

### S1 — ci(workflow): if always() en steps post-validate
- **Status**: done
- **Files**: `.github/workflows/validate.yml`
- **Gate**: lint
- acceptance:
  - "Step Integration verifier tiene if always"
  - "Step Validate package tiene if always"
  - "Comentario explicando el orden y la semántica"
- review-state: done
- review-implementer: orchestrator
- review-reviewer: delivery-verifier
- review-log: approved by delivery-verifier — Single-agent auto-review (orchestrator+delivery-verifier en el mismo árbol). 9afed13 añade if: ${{ always() }} en Integration verifier y Validate package; comentario explicativo presente. Validate pasa 3216/3216.
## acceptance

- Step Integration verifier tiene if always
- Step Validate package tiene if always
- Comentario explicando el orden y la semántica
