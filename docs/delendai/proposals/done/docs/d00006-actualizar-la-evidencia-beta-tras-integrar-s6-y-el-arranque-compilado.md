---
id: d00006
title: "Actualizar la evidencia beta tras integrar S6 y el arranque compilado"
kind: docs
status: done
type: proposal
track: general
date: 2026-11-19
last-transition-id: 049cc35e-f810-482f-9dfe-5f7a336274a5
last-correlation-id: 049cc35e-f810-482f-9dfe-5f7a336274a5
last-transition-from: review
last-transition-at: 2026-11-19T20:51:15.659Z
shipped-in:
  - "d5ffeef3df4f4b52ef8cc7e33ee1efec87750649"
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
- **Status**: done
- **Files**: `docs/BETA.md`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: lint
- acceptance:
  - "BETA documenta S6 integrado con acción explícita, texto acotado, rechazo de destinos privados y fallback, CI #187 y Chromium compilado sin keyring."
  - "BETA registra x00111 integrado, interfaz embebida fuera del repositorio, --static-dir, autodetección en checkout y pruebas independientes 11/11."
  - "BETA distingue cierre formal f00020 bloqueado por parser del pin y conserva aceptación humana, corpus más amplio, firma/GLib y f00021 opcional bloqueado."
- shipped-in: `6cde179d5f02`
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6.2-sol
- review-log: approved by openai-gpt-6.2-sol — verified at d5ffeef3df4f, validate exit 0 and tests 1/1 claimed, no recorded run cited; acceptance 3/3: (1) Comparé el diff con #187/#188, CI 44549773172 verde y smoke Chromium sobre binario real que ejecuté como revisor; todos los hechos figuran en BETA. (2) Las tres modalidades y el recuento coinciden con prueba independiente propia, #190 y el cierre x00111 de #193. (3) Reproduje guardSlicesComplete de 0.3.0 sobre las rutas existentes. El diff conserva criterios de beta externa y no modifica el estado de f00020/f00021. — Revisión independiente de #197 SHA exacto y CI 44612502783 verde. Lint docs local sobre 86ef766c y comparación de contenido con los resultados y operaciones propios citados. 1/1 gate local de documentación.

## acceptance

- BETA documenta S6 integrado con acción explícita, texto acotado, rechazo de destinos privados y fallback, CI #187 y Chromium compilado sin keyring.
- BETA registra x00111 integrado, interfaz embebida fuera del repositorio, --static-dir, autodetección en checkout y pruebas independientes 11/11.
- BETA distingue cierre formal f00020 bloqueado por parser del pin y conserva aceptación humana, corpus más amplio, firma/GLib y f00021 opcional bloqueado.
