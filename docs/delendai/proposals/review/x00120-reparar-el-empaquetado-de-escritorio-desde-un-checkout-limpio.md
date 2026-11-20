---
id: x00120
title: "Reparar el empaquetado de escritorio desde un checkout limpio"
kind: fix
status: review
type: proposal
track: desktop
date: 2026-11-20
last-transition-id: 58c09540-bb1c-403b-81c6-e054d0db493f
last-correlation-id: 58c09540-bb1c-403b-81c6-e054d0db493f
last-transition-from: in-progress
last-transition-at: 2026-11-20T22:03:26.898Z
---

# x00120 — Reparar el empaquetado de escritorio desde un checkout limpio

## goal

Hacer que los corredores nativos y los scripts locales compilen Angular y ejecuten la misma versión de Tauri al generar instaladores.

## why

La ejecución de escritorio de v0.2.0 falló al evaluar Bash en PowerShell en Windows y al invocar un subcomando cargo tauri inexistente en los corredores de macOS.

## non-goals

- Cambiar permisos, requisitos de auditoría o política de firma.
- Modificar los artefactos o el tag publicados de v0.2.0.

## slices

- global_gate: lint

### S1 — Script de escritorio autosuficiente y gate portable
- **Status**: review
- **Files**: `.github/workflows/release-desktop.yml`, `scripts/build/desktop-build.script.ts`, `package.json`, `bun.lock`, `tests/release/signing.spec.ts`, `docs/DESKTOP-INSTALL.md`
- **Gate**: e2e
- acceptance:
  - "La extracción del canal se ejecuta con Bash en todos los corredores de escritorio."
  - "desktop:build compila un frontend de producción y el sidecar con su nombre por plataforma e invoca el CLI Tauri fijado en el lockfile."
  - "La compilación se prueba desde checkout limpio sin credenciales de firma. Los controles de publicación permanecen activos."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `6ac40bd6e5c6`

## acceptance

- La extracción del canal se ejecuta con Bash en todos los corredores de escritorio.
- desktop:build compila un frontend de producción y el sidecar con su nombre por plataforma e invoca el CLI Tauri fijado en el lockfile.
- La compilación se prueba desde checkout limpio sin credenciales de firma. Los controles de publicación permanecen activos.
