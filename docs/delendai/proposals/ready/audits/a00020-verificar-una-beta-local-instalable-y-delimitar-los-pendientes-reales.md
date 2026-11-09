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

- Publicar una versión o certificar plataformas que no se han ejecutado en esta máquina.

## slices

- global_gate: none

### S1 — Evidencia reproducible y contrato de beta cerrada
- **Status**: done
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

## evidence

- Binary, web production build, real authenticated Application API, binary-to-web history visibility, real filesystem watch and isolated packed installation verified; evidence and remaining acceptance are in docs/BETA.md.
- Independent review identified same-millisecond run collision; it is tracked and being fixed in x00090.
- Optional integration workflow still followed moving develop; x00091 fixes it against the same immutable runtime pin and common branch policy.
