---
id: x00120
title: "Reparar el empaquetado de escritorio desde un checkout limpio"
kind: fix
status: in-progress
type: proposal
track: desktop
date: 2026-11-20
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
- **Status**: pending
- **Files**: `.github/workflows/release-desktop.yml`, `scripts/build/desktop-build.script.ts`, `package.json`, `bun.lock`, `tests/release/signing.spec.ts`, `docs/DESKTOP-INSTALL.md`
- **Gate**: e2e
- acceptance:
  - "La extracción del canal se ejecuta con Bash en todos los corredores de escritorio."
  - "desktop:build compila un frontend de producción y el sidecar con su nombre por plataforma e invoca el CLI Tauri fijado en el lockfile."
  - "La compilación se prueba desde checkout limpio sin credenciales de firma. Los controles de publicación permanecen activos."

## acceptance

- La extracción del canal se ejecuta con Bash en todos los corredores de escritorio.
- desktop:build compila un frontend de producción y el sidecar con su nombre por plataforma e invoca el CLI Tauri fijado en el lockfile.
- La compilación se prueba desde checkout limpio sin credenciales de firma. Los controles de publicación permanecen activos.
