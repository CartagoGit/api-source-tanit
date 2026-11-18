---
id: x00105
title: "Actualizar Tokio a una versión corregida en el escritorio"
kind: fix
status: review
type: proposal
track: desktop
date: 2026-11-18
last-transition-id: d2457922-9fba-4a32-9d5c-02ee302246dc
last-correlation-id: d2457922-9fba-4a32-9d5c-02ee302246dc
last-transition-from: in-progress
last-transition-at: 2026-11-18T15:30:38.553Z
---

# x00105 — Actualizar Tokio a una versión corregida en el escritorio

## goal

Actualizar únicamente Tokio a 1.53.3 en el lock de escritorio y verificar que desaparece RUSTSEC-2026-0386 con RustSec.

## why

El lock fija Tokio 1.53.1. RustSec identifica 1.53.3 como primera versión corregida de la misma serie.

## non-goals

- Migración GTK/GLib y certificación de release, seguidas en s00001.

## slices

- global_gate: e2e

### S1 — Actualizar y validar el lock de Tokio
- **Status**: review
- **Files**: `packages/desktop/Cargo.lock`
- **Gate**: e2e
- acceptance:
  - "El único paquete que cambia de versión es Tokio, de 1.53.1 a 1.53.3."
  - "Cargo resuelve el lock en Linux y Windows con --locked y el escritorio compila con --all-targets en Linux."
  - "Cargo Audit ya no informa RUSTSEC-2026-0386 y sigue mostrando cualquier aviso independiente."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `0f34d849d28c`

## acceptance

- El único paquete que cambia de versión es Tokio, de 1.53.1 a 1.53.3.
- Cargo resuelve el lock en Linux y Windows con --locked y el escritorio compila con --all-targets en Linux.
- Cargo Audit ya no informa RUSTSEC-2026-0386 y sigue mostrando cualquier aviso independiente.
