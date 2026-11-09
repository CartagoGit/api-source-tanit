---
id: a00020
title: "Verificar una beta local instalable y delimitar los pendientes reales"
kind: audit
status: review
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: 9e67998b-3074-4ddf-a652-5b5505ad036a
last-correlation-id: 9e67998b-3074-4ddf-a652-5b5505ad036a
last-transition-from: in-progress
last-transition-at: 2026-11-09T15:29:01.057Z
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
- shipped-in: `ade9fced284f`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

## acceptance

- El binario Linux inicia sin Bun ni DelendAI en PATH.
- Express y Laravel exportan OpenAPI verificable desde el artefacto.
- La web compila y responde con su API real autenticada.
- Cada pendiente de beta tiene alcance y evidencia concretos.

## evidence

- Binary, web production build, real authenticated Application API, binary-to-web history visibility, real filesystem watch and isolated packed installation verified; evidence and remaining acceptance are in docs/BETA.md.
- The rebuilt final Linux artifact exports9 Express and19 Laravel operations without Bun/DelendAI in PATH; OpenAPI local references resolve and all artifact checksums pass.
- A real browser opens the project, shows9 indexed operations, generates a real file and displays its persisted revision; temporary profiles require no desktop keyring.
- The same-millisecond run collision identified by independent review is fixed and merged through x00090 (PR126).
- The optional integration uses the immutable runtime pin and common branch policy (PR127), with clean-runner root dependency installation (PR130). The real GitHub integration run42640433383 passed.
