---
id: x00128
title: "Ajustes claros con temas persistentes e idioma sincronizado"
kind: fix
status: review
type: proposal
track: ux
date: 2026-11-21
last-transition-id: 534eb873-0449-4c1f-b3eb-87ff91706d58
last-correlation-id: 534eb873-0449-4c1f-b3eb-87ff91706d58
last-transition-from: in-progress
last-transition-at: 2026-11-21T13:59:22.613Z
---

# x00128 — Ajustes claros con temas persistentes e idioma sincronizado

## goal

Cambiar idioma y apariencia desde Ajustes con vista previa y selección persistente.

## why

La selección de idioma puede enseñar inglés aunque el catálogo activo sea español y solo se pueden alternar dos apariencias sin previa.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: lint

### S1 — Rediseñar Ajustes con controles accesibles de idioma y tema
- **Status**: review
- **Files**: `packages/app/src/app/features/settings/settings.component.ts`, `packages/app/src/app/features/settings/settings.component.html`, `packages/app/src/app/features/settings/settings.component.scss`, `packages/app/src/app/core/i18n/locales/en.json`, `packages/app/src/app/core/i18n/locales/es.json`, `packages/app/src/app/core/i18n/locales/fr.json`, `packages/app/src/app/core/state/theme.store.ts`, `packages/app/src/styles/tokens.scss`, `packages/app/src/styles.scss`, `tests/app/i18n.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "El selector refleja el idioma activo también al abrir con idioma guardado."
  - "La elección de tema persiste al recargar; el modo sistema sigue el esquema del dispositivo."
  - "Ajustes separa preferencias y credenciales y se puede usar con teclado y pantallas estrechas."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `6f7ccdfb4e00`

## acceptance

- El selector refleja el idioma activo también al abrir con idioma guardado.
- La elección de tema persiste al recargar; el modo sistema sigue el esquema del dispositivo.
- Ajustes separa preferencias y credenciales y se puede usar con teclado y pantallas estrechas.
