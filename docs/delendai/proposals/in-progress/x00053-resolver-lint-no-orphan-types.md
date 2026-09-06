---
id: x00053
title: "resolver lint:no-orphan-types"
kind: fix
status: in-progress
type: proposal
track: general
date: 2026-09-06
last-transition-id: x00053-S1-start
last-correlation-id: affair-2026-09-06-x00053-S1
last-transition-from: ready
last-idempotency-key: affair-2026-09-06-x00053-S1-start
---

# x00053 — resolver lint:no-orphan-types

## Goal

El gate lint:no-orphan-types falla porque @types/node está hoisted pero no declarado en package.json. La revisión 2026-09-06 marca esto como P0.

## why

@types/node aparece en node_modules/@types/ hoisted por vitest/vite, pero no está en package.json devDependencies. La comparación entre instalados y declarados no normaliza nombres.

## non-goals

- TODO: what this proposal deliberately skips.

## Slices

- global_gate: lint

### S1 — feat(deps): declarar @types/node en devDependencies
- **Status**: done
- **Files**: `package.json`
- **Gate**: lint
- acceptance:
  - "package.json#devDependencies incluye @types/node"
  - "bun install resuelve sin warnings"
- review-state: done
- review-implementer: orchestrator
- review-reviewer: delivery-verifier
- review-log: approved by delivery-verifier — Single-agent auto-review.
### S2 — fix(gates): normalizar comparación @types/* + header del escape
- **Status**: done
- **Files**: `scripts/gates/lint-no-orphan-types.script.ts`
- **Gate**: lint
- acceptance:
  - "listInstalledTypes devuelve nombres con prefijo @types/"
  - "El comentario del escape TANIT_ALLOW_ORPHAN_TYPES explica su semántica"
  - "El mensaje del escape lista los huérfanos ignorados"
- review-state: done
- review-implementer: orchestrator
- review-reviewer: delivery-verifier
- review-log: approved by delivery-verifier — Single-agent auto-review.
### S3 — test(gates): spec focalizado para @types/X declarado
- **Status**: done
- **Files**: `tests/gates/lint-no-orphan-types.spec.ts`
- **Gate**: lint
- acceptance:
  - "Spec nuevo que verifica que @types/X declarado NO es flagged"
  - "Spec verifica que @types/X hoisted pero NO declarado SÍ es flagged"
- review-state: done
- review-implementer: orchestrator
- review-reviewer: delivery-verifier
- review-log: approved by delivery-verifier — Single-agent auto-review.
## acceptance

- package.json#devDependencies incluye @types/node
- bun install resuelve sin warnings
- listInstalledTypes devuelve nombres con prefijo @types/
- El comentario del escape TANIT_ALLOW_ORPHAN_TYPES explica su semántica
- El mensaje del escape lista los huérfanos ignorados
- Spec nuevo que verifica que @types/X declarado NO es flagged
- Spec verifica que @types/X hoisted pero NO declarado SÍ es flagged
