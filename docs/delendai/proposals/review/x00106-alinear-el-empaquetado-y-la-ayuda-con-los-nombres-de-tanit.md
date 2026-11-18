---
id: x00106
title: "Alinear el empaquetado y la ayuda con los nombres de Tanit"
kind: fix
status: review
type: proposal
track: desktop
date: 2026-11-18
last-transition-id: 2db180dc-6cf2-482b-8983-7716a1287753
last-correlation-id: 2db180dc-6cf2-482b-8983-7716a1287753
last-transition-from: in-progress
last-transition-at: 2026-11-18T15:47:51.542Z
---

# x00106 — Alinear el empaquetado y la ayuda con los nombres de Tanit

## goal

Hacer efectivo el formato deb de Docker y usar el ejecutable apisrc en la ayuda generada.

## why

Compose declara TANIT_BUNDLES y el empaquetador lee EXPOSTMAN_BUNDLES. El valor deb se pierde y se intenta generar AppImage en Docker. La ayuda de la API conserva un comando retirado.

## non-goals

- Cambios en firma, perfiles de release o referencias históricas.

## slices

- global_gate: e2e

### S1 — Usar TANIT_BUNDLES y apisrc en los productores activos
- **Status**: review
- **Files**: `scripts/build/desktop-build.script.ts`, `.github/workflows/release-desktop.yml`, `tests/release/signing.spec.ts`, `scripts/build/api-reference.script.ts`, `docs/API.md`, `scripts/gates/lint-naming.script.ts`, `scripts/gates/bench-scan.script.ts`
- **Gate**: e2e
- acceptance:
  - "El empaquetador consume TANIT_BUNDLES, la matriz CI lo emite y Compose sigue limitando su servicio de empaquetado a deb."
  - "docs/API.md se genera con apisrc --help y los diagnósticos de herramientas activas usan el nombre actual."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `d8250fcdf4ee`

## acceptance

- El empaquetador consume TANIT_BUNDLES, la matriz CI lo emite y Compose sigue limitando su servicio de empaquetado a deb.
- docs/API.md se genera con apisrc --help y los diagnósticos de herramientas activas usan el nombre actual.
