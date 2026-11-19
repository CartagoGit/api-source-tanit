---
id: x00110
title: "Excluir artefactos Rust del paquete npm"
kind: fix
status: review
type: proposal
track: general
date: 2026-11-19
last-transition-id: 565d7c24-9013-41c1-b9ff-e5a6945aa283
last-correlation-id: 565d7c24-9013-41c1-b9ff-e5a6945aa283
last-transition-from: in-progress
last-transition-at: 2026-11-19T07:45:08.132Z
---

# x00110 — Excluir artefactos Rust del paquete npm

## goal

Excluir packages/desktop/target del paquete preservando los archivos distribuibles.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: lint

### S1 — Excluir target y comprobar packlist
- **Status**: review
- **Files**: `package.json`, `tests/scripts-gates/package-packlist.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: none
- acceptance:
  - "npm pack excluye target y conserva Rust, core y Angular usando el manifiesto real."
  - "Validación de paquete y prueba focal superadas."
- shipped-in: `d0a9d3300905`
- review-state: in_review
- review-implementer: openai-gpt-6.1-terra

## acceptance

- npm pack excluye target y conserva Rust, core y Angular usando el manifiesto real.
- Validación de paquete y prueba focal superadas.
