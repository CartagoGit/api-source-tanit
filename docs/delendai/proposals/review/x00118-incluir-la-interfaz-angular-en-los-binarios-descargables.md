---
id: x00118
title: "Incluir la interfaz Angular en los binarios descargables"
kind: fix
status: review
type: proposal
track: beta
date: 2026-11-20
last-transition-id: da3b2f74-04b9-4dcc-a25f-00a03b364584
last-correlation-id: da3b2f74-04b9-4dcc-a25f-00a03b364584
last-transition-from: in-progress
last-transition-at: 2026-11-20T07:41:53.200Z
---

# x00118 — Incluir la interfaz Angular en los binarios descargables

## goal

Distribuir un binario autocontenido que sirva la misma aplicación Angular que la web y el escritorio.

## why

El script de prueba sirve un build externo y el binario distribuido cae en la interfaz antigua al salir del repositorio.

## non-goals

- Publicar o firmar instaladores de escritorio.

## slices

- global_gate: lint

### S1 — Empaquetar y verificar el build Angular en el binario
- **Status**: review
- **Files**: `scripts/build/build-binary.script.ts`, `packages/cli/commands/ui.script.ts`, `packages/contracts/constants/cli/terminal.constant.ts`, `tests/cli/compiled-binary.test.ts`, `README.md`, `docs/UI.md`
- **Gate**: e2e
- acceptance:
  - "El build por plataforma y --all incluyen Angular y su logo en cada binario. --all compila Angular una sola vez."
  - "apisrc ui funciona fuera del checkout sin Bun, Node o archivos de frontend auxiliares. Con --static-dir sigue sirviendo el directorio explícito."
  - "Chromium en WSL y Chrome nativo en Windows abren el proyecto, navegan, exportan y sobreviven a una recarga usando solo el ejecutable entregado."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `05e01d93a6ad`

## acceptance

- El build por plataforma y --all incluyen Angular y su logo en cada binario. --all compila Angular una sola vez.
- apisrc ui funciona fuera del checkout sin Bun, Node o archivos de frontend auxiliares. Con --static-dir sigue sirviendo el directorio explícito.
- Chromium en WSL y Chrome nativo en Windows abren el proyecto, navegan, exportan y sobreviven a una recarga usando solo el ejecutable entregado.
