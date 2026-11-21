---
id: c00013
title: "Preparar la alfa 0.3.0-alpha.1 de Tanit"
kind: chore
status: review
type: proposal
track: release
date: 2026-11-21
last-transition-id: b7d7efe9-9b4a-49d7-b6f9-1531b6760237
last-correlation-id: b7d7efe9-9b4a-49d7-b6f9-1531b6760237
last-transition-from: in-progress
last-transition-at: 2026-11-21T04:19:44.095Z
---

# c00013 — Preparar la alfa 0.3.0-alpha.1 de Tanit

## goal

Promover una alfa verificable de Tanit y documentar la apertura del ejecutable de Windows.

## why

Publicar los avances desde 0.2.0 durante la iteración de la experiencia de escritorio.

## non-goals

- Cambiar las reglas de firma o certificar los instaladores de escritorio.

## slices

- global_gate: lint

### S1 — Sincronizar la versión y preparar las notas de publicación
- **Status**: review
- **Files**: `package.json`, `packages/desktop/tauri.conf.json`, `packages/contracts/constants/cli/cli-version.constant.ts`, `CHANGELOG.md`, `docs/DESKTOP-INSTALL.md`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: lint
- acceptance:
  - "La versión 0.3.0-alpha.1 es coherente entre paquete, CLI y Tauri y se clasifica como prerelease alfa."
  - "El changelog cubre los cambios de producto desde 0.2.0 y la documentación explica el icono al ejecutar desde WSL."
  - "La promoción a main supera sus validaciones y el tag crea la prerelease con sus binarios autocontenidos."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `54e294eb6ee9`

## acceptance

- La versión 0.3.0-alpha.1 es coherente entre paquete, CLI y Tauri y se clasifica como prerelease alfa.
- El changelog cubre los cambios de producto desde 0.2.0 y la documentación explica el icono al ejecutar desde WSL.
- La promoción a main supera sus validaciones y el tag crea la prerelease con sus binarios autocontenidos.
