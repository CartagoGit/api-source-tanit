---
id: x00110
title: "Excluir artefactos Rust del paquete npm"
kind: fix
status: ready
type: proposal
track: general
date: 2026-11-19
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
- **Status**: pending
- **Files**: `package.json`, `tests/scripts-gates/package-packlist.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: none
- acceptance:
  - "npm pack excluye target y conserva Rust, core y Angular usando el manifiesto real."
  - "Validación de paquete y prueba focal superadas."

## acceptance

- npm pack excluye target y conserva Rust, core y Angular usando el manifiesto real.
- Validación de paquete y prueba focal superadas.
