---
id: x00128
title: "Ajustes claros con temas persistentes e idioma sincronizado"
kind: fix
status: in-progress
type: proposal
track: ux
date: 2026-11-21
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
- **Status**: pending
- **Files**: `packages/app/src/app/features/settings/settings.component.ts`, `packages/app/src/app/features/settings/settings.component.html`, `packages/app/src/app/features/settings/settings.component.scss`, `packages/app/src/app/core/i18n/locales/en.json`, `packages/app/src/app/core/i18n/locales/es.json`, `packages/app/src/app/core/i18n/locales/fr.json`, `packages/app/src/app/core/state/theme.store.ts`, `packages/app/src/styles/tokens.scss`, `packages/app/src/styles.scss`, `tests/app/i18n.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "El selector refleja el idioma activo también al abrir con idioma guardado."
  - "La elección de tema persiste al recargar; el modo sistema sigue el esquema del dispositivo."
  - "Ajustes separa preferencias y credenciales y se puede usar con teclado y pantallas estrechas."

## acceptance

- El selector refleja el idioma activo también al abrir con idioma guardado.
- La elección de tema persiste al recargar; el modo sistema sigue el esquema del dispositivo.
- Ajustes separa preferencias y credenciales y se puede usar con teclado y pantallas estrechas.
