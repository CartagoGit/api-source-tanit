---
id: a00020
title: "Verificar una beta local instalable y delimitar los pendientes reales"
kind: audit
status: ready
type: proposal
track: api-source-tanit
date: 2026-11-09
---

# a00020 — Verificar una beta local instalable y delimitar los pendientes reales

## goal

Comprobar desde artefactos locales el CLI autónomo, exportación Express/Laravel y web compilada; documentar evidencia y bloqueos sin confundir código preparado con entregado.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — Evidencia reproducible y contrato de beta cerrada
- **Status**: pending
- **Files**: `docs/BETA.md`
- **Gate**: e2e
- acceptance:
  - "El binario Linux inicia sin Bun ni DelendAI en PATH."
  - "Express y Laravel exportan OpenAPI verificable desde el artefacto."
  - "La web compila y responde con su API real autenticada."
  - "Cada pendiente de beta tiene alcance y evidencia concretos."

## acceptance

- El binario Linux inicia sin Bun ni DelendAI en PATH.
- Express y Laravel exportan OpenAPI verificable desde el artefacto.
- La web compila y responde con su API real autenticada.
- Cada pendiente de beta tiene alcance y evidencia concretos.
