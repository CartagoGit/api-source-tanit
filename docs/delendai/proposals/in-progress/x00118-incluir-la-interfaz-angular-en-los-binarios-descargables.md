---
id: x00118
title: "Incluir la interfaz Angular en los binarios descargables"
kind: fix
status: in-progress
type: proposal
track: beta
date: 2026-11-20
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
- **Status**: pending
- **Files**: `scripts/build/build-binary.script.ts`, `packages/cli/commands/ui.script.ts`, `packages/contracts/constants/cli/terminal.constant.ts`, `tests/cli/compiled-binary.test.ts`, `README.md`, `docs/UI.md`
- **Gate**: e2e
- acceptance:
  - "El build por plataforma y --all incluyen Angular y su logo en cada binario. --all compila Angular una sola vez."
  - "apisrc ui funciona fuera del checkout sin Bun, Node o archivos de frontend auxiliares. Con --static-dir sigue sirviendo el directorio explícito."
  - "Chromium en WSL y Chrome nativo en Windows abren el proyecto, navegan, exportan y sobreviven a una recarga usando solo el ejecutable entregado."

## acceptance

- El build por plataforma y --all incluyen Angular y su logo en cada binario. --all compila Angular una sola vez.
- apisrc ui funciona fuera del checkout sin Bun, Node o archivos de frontend auxiliares. Con --static-dir sigue sirviendo el directorio explícito.
- Chromium en WSL y Chrome nativo en Windows abren el proyecto, navegan, exportan y sobreviven a una recarga usando solo el ejecutable entregado.
