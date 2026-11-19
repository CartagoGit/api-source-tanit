---
id: x00106
title: "Alinear el empaquetado y la ayuda con los nombres de Tanit"
kind: fix
status: done
type: proposal
track: desktop
date: 2026-11-18
last-transition-id: 654af854-e583-4a37-8832-b1e169a61228
last-correlation-id: 654af854-e583-4a37-8832-b1e169a61228
last-transition-from: review
last-transition-at: 2026-11-19T20:46:10.999Z
shipped-in:
  - "76a51069cb34ec6c918f60f86f2954c031b2d046"
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
- **Status**: done
- **Files**: `scripts/build/desktop-build.script.ts`, `.github/workflows/release-desktop.yml`, `tests/release/signing.spec.ts`, `scripts/build/api-reference.script.ts`, `docs/API.md`, `scripts/gates/lint-naming.script.ts`, `scripts/gates/bench-scan.script.ts`
- **Gate**: e2e
- acceptance:
  - "El empaquetador consume TANIT_BUNDLES, la matriz CI lo emite y Compose sigue limitando su servicio de empaquetado a deb."
  - "docs/API.md se genera con apisrc --help y los diagnósticos de herramientas activas usan el nombre actual."
- shipped-in: `d8250fcdf4ee`
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6.1-terra
- review-log: approved by openai-gpt-6.1-terra — verified at 76a51069cb34, validate exit 0 and tests 1/1 claimed, no recorded run cited; acceptance 2/2: (1) signing.spec.ts test de matriz y compose 1/1; script y workflow revisados (2) diff api-reference, lint-naming y bench-scan revisado; CI #169 verde — CI #169 verde; test focal bundles 1/1.

## acceptance

- El empaquetador consume TANIT_BUNDLES, la matriz CI lo emite y Compose sigue limitando su servicio de empaquetado a deb.
- docs/API.md se genera con apisrc --help y los diagnósticos de herramientas activas usan el nombre actual.
