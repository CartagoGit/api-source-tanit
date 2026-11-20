---
id: c00012
title: "Preparar la versión 0.2.0 con notas completas y canal de prerelease"
kind: chore
status: review
type: proposal
track: beta
date: 2026-11-20
last-transition-id: 3eb60b56-b796-48ed-9b85-2263bc478abe
last-correlation-id: 3eb60b56-b796-48ed-9b85-2263bc478abe
last-transition-from: in-progress
last-transition-at: 2026-11-20T08:10:05.349Z
---

# c00012 — Preparar la versión 0.2.0 con notas completas y canal de prerelease

## goal

Preparar el candidato 0.2.0 del CLI y la interfaz Angular para la promoción a main por el flujo de release existente.

## why

Una minor sin sufijo se clasificaba estable. Los binarios del candidato y las notas deben identificar la misma versión sin certificar instaladores pendientes.

## non-goals

- Cambiar los permisos, protecciones de rama o la política de firma.
- Anunciar instaladores de escritorio certificados.

## slices

- global_gate: lint

### S1 — Versión, canal, notas y matriz de lanzamiento
- **Status**: review
- **Files**: `package.json`, `packages/contracts/constants/cli/cli-version.constant.ts`, `packages/desktop/tauri.conf.json`, `scripts/helpers/release-channel.helper.ts`, `scripts/gates/lint-release-channel.script.ts`, `packages/contracts/constants/release/release-channel.constant.ts`, `tests/release/release-channel.spec.ts`, `.github/workflows/release-desktop.yml`, `.github/workflows/release-binaries.yml`, `.github/workflows/release-cut.yml`, `docs/BETA.md`, `docs/RELEASE.md`, `CHANGELOG.md`
- **Gate**: e2e
- acceptance:
  - "Paquete, CLI y Tauri declaran 0.2.0 con notas a partir de la última release."
  - "Las versiones 0.x sin sufijo se clasifican como beta y las sin sufijo desde 1.0 como estables. Los canales históricos se mantienen."
  - "CI construye los cinco binarios desde una interfaz común y la publicación de instaladores sigue sujeta al canal y la firma."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `45ff546777d0`

## acceptance

- Paquete, CLI y Tauri declaran 0.2.0 con notas a partir de la última release.
- Las versiones 0.x sin sufijo se clasifican como beta y las sin sufijo desde 1.0 como estables. Los canales históricos se mantienen.
- CI construye los cinco binarios desde una interfaz común y la publicación de instaladores sigue sujeta al canal y la firma.
