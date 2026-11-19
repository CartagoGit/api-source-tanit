---
id: x00110
title: "Excluir artefactos Rust del paquete npm"
kind: fix
status: in-progress
type: proposal
track: general
date: 2026-11-19
last-transition-id: ceceb351-e353-4987-a79e-37c4e9ea9868
last-correlation-id: ceceb351-e353-4987-a79e-37c4e9ea9868
last-transition-from: ready
last-transition-at: 2026-11-19T07:38:52.412Z
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
