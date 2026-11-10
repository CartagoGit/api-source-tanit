---
id: s00001
title: "Resolver bloqueo GLib transitivo antes de certificar escritorio Linux"
kind: spike
status: ready
type: proposal
track: desktop
date: 2026-11-10
---

# s00001 — Resolver bloqueo GLib transitivo antes de certificar escritorio Linux

## goal

Verificar migración soportada Tauri/GTK antes de distribuir escritorio Linux como beta certificada.

## why

glib0.18.5 transitivo GTK0.18/Tauri afectado por RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g; upgrade aislado no satisface restricciones actuales.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — Migración compatible y certificación
- **Status**: pending
- **Files**: `packages/desktop/Cargo.toml`, `packages/desktop/Cargo.lock`, `docs/BETA.md`
- **Gate**: e2e
- acceptance:
  - "Verificar advisory y árbol de dependencias con fecha; ausencia de llamadas propias no prueba inalcanzabilidad transitiva."
  - "Adoptar solución compatible upstream verificada; no ocultar advisory ni forzar parche incompatible."
  - "Auditoría sin vulnerabilidad, pruebas Rust y smoke real de instalador Linux antes de levantar bloqueo; demás plataformas requieren aceptación propia."

## acceptance

- Verificar advisory y árbol de dependencias con fecha; ausencia de llamadas propias no prueba inalcanzabilidad transitiva.
- Adoptar solución compatible upstream verificada; no ocultar advisory ni forzar parche incompatible.
- Auditoría sin vulnerabilidad, pruebas Rust y smoke real de instalador Linux antes de levantar bloqueo; demás plataformas requieren aceptación propia.
