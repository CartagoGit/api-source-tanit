---
id: d00006
title: "Actualizar la evidencia beta tras integrar S6 y el arranque compilado"
kind: docs
status: ready
type: proposal
track: general
date: 2026-11-19
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
- **Status**: pending
- **Files**: `docs/BETA.md`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: lint
- acceptance:
  - "BETA documenta S6 integrado con acción explícita, texto acotado, rechazo de destinos privados y fallback, CI #187 y Chromium compilado sin keyring."
  - "BETA registra x00111 integrado, interfaz embebida fuera del repositorio, --static-dir, autodetección en checkout y pruebas independientes 11/11."
  - "BETA distingue cierre formal f00020 bloqueado por parser del pin y conserva aceptación humana, corpus más amplio, firma/GLib y f00021 opcional bloqueado."

## acceptance

- BETA documenta S6 integrado con acción explícita, texto acotado, rechazo de destinos privados y fallback, CI #187 y Chromium compilado sin keyring.
- BETA registra x00111 integrado, interfaz embebida fuera del repositorio, --static-dir, autodetección en checkout y pruebas independientes 11/11.
- BETA distingue cierre formal f00020 bloqueado por parser del pin y conserva aceptación humana, corpus más amplio, firma/GLib y f00021 opcional bloqueado.
