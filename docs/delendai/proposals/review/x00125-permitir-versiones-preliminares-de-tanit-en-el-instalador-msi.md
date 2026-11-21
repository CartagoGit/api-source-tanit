---
id: x00125
title: "Permitir versiones preliminares de Tanit en el instalador MSI"
kind: fix
status: review
type: proposal
track: desktop
date: 2026-11-21
last-transition-id: 40ec6705-3078-4bca-ac19-03ed9af763b8
last-correlation-id: 40ec6705-3078-4bca-ac19-03ed9af763b8
last-transition-from: in-progress
last-transition-at: 2026-11-21T04:35:04.991Z
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
- **Status**: review
- **Files**: `scripts/build/desktop-build.script.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "El build Windows de una versión con etiqueta alfa genera MSI y NSIS."
  - "Solo WiX usa el núcleo numérico de la versión. El CLI, Tauri, NSIS y la release mantienen la versión SemVer completa."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `be814d9f7839`

## acceptance

- El build Windows de una versión con etiqueta alfa genera MSI y NSIS.
- Solo WiX usa el núcleo numérico de la versión. El CLI, Tauri, NSIS y la release mantienen la versión SemVer completa.
