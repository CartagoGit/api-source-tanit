---
id: x00091
title: "Eliminar deriva de runtime y protecciones en workflows auxiliares"
kind: fix
status: ready
type: proposal
track: api-source-tanit
date: 2026-11-09
---

# x00091 — Eliminar deriva de runtime y protecciones en workflows auxiliares

## goal

La integración opcional de CI debe ejecutar el mismo commit DelendAI 0.3.0 que el proyecto y las protecciones deben aplicar exactamente la política común, preservando los valores false explícitos.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — Runtime inmutable y protecciones derivadas de la política
- **Status**: pending
- **Files**: `.github/workflows/integration-delendai.yml`, `.github/workflows/protect-develop.yml`, `scripts/gates/branch-protection-payload.script.ts`, `tests/scripts-gates/integration-delendai-workflow.spec.ts`, `tests/scripts-gates/branch-protection.spec.ts`, `integrations/delendai/package.json`
- **Gate**: e2e
- acceptance:
  - "CI lee el pin JSON y verifica su commit, sin checkout develop ni sibling obligatorio."
  - "La integración no modifica reglas de rama."
  - "El aplicador de protecciones usa las mismas funciones que el verificador y conserva false."
  - "La validación local del plugin usa el core fijado."

## acceptance

- CI lee el pin JSON y verifica su commit, sin checkout develop ni sibling obligatorio.
- La integración no modifica reglas de rama.
- El aplicador de protecciones usa las mismas funciones que el verificador y conserva false.
- La validación local del plugin usa el core fijado.
