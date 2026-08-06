---
id: p00040
title: "p00040 — documentación generada automáticamente: API docs site, JSDoc/TSDoc y CHANGELOG semántico"
kind: feat
status: ready
type: proposal
track: postman-exporter
date: 2026-08-06
related:
    - p00037
---

# p00040 — documentación generada automáticamente: API docs site, JSDoc/TSDoc y CHANGELOG semántico

## Goal

Generar automáticamente un sitio de documentación de la API pública del
paquete, completar la cobertura de JSDoc/TSDoc en todos los exports
públicos y automatizar la generación de CHANGELOG a partir de
Conventional Commits.

## why

Un proyecto 11/10 no solo funciona bien, sino que está **documentado
impecablemente**:

1. **TSDoc en exports públicos**: Cada función, interfaz y tipo exportado
   tiene documentación de propósito, parámetros y retorno.
2. **Sitio de docs**: Un site generado (VitePress / TypeDoc) publicable
   en GitHub Pages con guías de uso, API reference y ejemplos.
3. **CHANGELOG automático**: Generado por `conventional-changelog` desde
   los commits `fix:`, `feat:`, `feat!:`.

## non-goals

- Documentar código interno no exportado.
- Mantener el sitio de docs en un repo separado.

## slices

### S1 — Cobertura TSDoc 100% en exports públicos
- **Files**: `contracts/*.ts`, `services/*.ts` (solo exports), `helpers/*.ts`.
- **Gate**: `bun run lint:docs` (linter de TSDoc coverage).
- Cada función exportada debe tener `@param`, `@returns` y `@example`.

### S2 — Generación de API reference con TypeDoc
- **Files**: `typedoc.json`, `docs/api/`.
- **Gate**: `bun run docs:build` sin errores.

### S3 — CHANGELOG automático
- **Files**: `.changelogrc.json`, `CHANGELOG.md`.
- **Gate**: `bun run changelog` genera la versión correcta.

### S4 — GitHub Pages deployment
- **Files**: `.github/workflows/docs.yml`.
- **Gate**: push y verificación del site en Pages.

## acceptance

- Sitio de docs generado sin errores y navegable.
- CHANGELOG generado automáticamente en cada release.
- 100% TSDoc coverage en exports públicos.
- `bun run validate` verde.
