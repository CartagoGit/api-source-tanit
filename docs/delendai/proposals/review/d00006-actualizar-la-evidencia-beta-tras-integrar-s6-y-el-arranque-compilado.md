---
id: d00006
title: "Actualizar la evidencia beta tras integrar S6 y el arranque compilado"
kind: docs
status: review
type: proposal
track: general
date: 2026-11-19
last-transition-id: 50a382c2-2bf5-4d4c-a76e-81f0f91e1a4a
last-correlation-id: 50a382c2-2bf5-4d4c-a76e-81f0f91e1a4a
last-transition-from: in-progress
last-transition-at: 2026-11-19T20:48:27.274Z
---

# d00006 — Actualizar la evidencia beta tras integrar S6 y el arranque compilado

## goal

Reflejar entregas S6 y x00111 integradas sin confundir producto, cierre formal ni aceptación externa.

## why

BETA aún presenta S6 remoto como pendiente después de #187 y #188 integrados.

## non-goals

- Cambiar producto o estados formales de f00020 y f00021.
- Certificar aceptación humana, escritorio firmado o corpus más amplio.

## slices

- global_gate: lint

### S1 — Actualizar evidencia beta integrada y pendientes reales
- **Status**: review
- **Files**: `docs/BETA.md`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: lint
- acceptance:
  - "BETA documenta S6 integrado con acción explícita, texto acotado, rechazo de destinos privados y fallback, CI #187 y Chromium compilado sin keyring."
  - "BETA registra x00111 integrado, interfaz embebida fuera del repositorio, --static-dir, autodetección en checkout y pruebas independientes 11/11."
  - "BETA distingue cierre formal f00020 bloqueado por parser del pin y conserva aceptación humana, corpus más amplio, firma/GLib y f00021 opcional bloqueado."
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol
- shipped-in: `6cde179d5f02`

## acceptance

- BETA documenta S6 integrado con acción explícita, texto acotado, rechazo de destinos privados y fallback, CI #187 y Chromium compilado sin keyring.
- BETA registra x00111 integrado, interfaz embebida fuera del repositorio, --static-dir, autodetección en checkout y pruebas independientes 11/11.
- BETA distingue cierre formal f00020 bloqueado por parser del pin y conserva aceptación humana, corpus más amplio, firma/GLib y f00021 opcional bloqueado.
