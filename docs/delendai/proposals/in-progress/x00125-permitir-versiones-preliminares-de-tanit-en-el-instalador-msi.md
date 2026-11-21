---
id: x00125
title: "Permitir versiones preliminares de Tanit en el instalador MSI"
kind: fix
status: in-progress
type: proposal
track: desktop
date: 2026-11-21
---

# x00125 — Permitir versiones preliminares de Tanit en el instalador MSI

## goal

Compilar MSI para la alfa sin perder la versión preliminar del producto.

## why

El corredor Windows rechaza 0.3.0-alpha.1 como ProductVersion de WiX.

## non-goals

- Cambiar la política de firma o el canal de publicación.

## slices

- global_gate: lint

### S1 — Derivar la versión numérica de WiX al construir Windows
- **Status**: pending
- **Files**: `scripts/build/desktop-build.script.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "El build Windows de una versión con etiqueta alfa genera MSI y NSIS."
  - "Solo WiX usa el núcleo numérico de la versión. El CLI, Tauri, NSIS y la release mantienen la versión SemVer completa."

## acceptance

- El build Windows de una versión con etiqueta alfa genera MSI y NSIS.
- Solo WiX usa el núcleo numérico de la versión. El CLI, Tauri, NSIS y la release mantienen la versión SemVer completa.
