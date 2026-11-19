---
id: x00111
title: "Arranque autónomo de UI en binario compilado"
kind: fix
status: review
type: proposal
track: general
date: 2026-11-19
last-transition-id: 7799a7df-77de-4026-a236-443624c2abb5
last-correlation-id: 7799a7df-77de-4026-a236-443624c2abb5
last-transition-from: in-progress
last-transition-at: 2026-11-19T15:05:53.737Z
shipped-in:
  - "4961ed70795d0eedddf63bddc8cf8cb30fa17b3e"
---

# x00111 — Arranque autónomo de UI en binario compilado

## goal

Permitir que apisrc ui arranque fuera del repositorio y respete el directorio estático explícito.

## why

El helper de scripts falla al buscar la raíz dentro del sistema virtual del binario.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — Resolver assets sin depender del árbol del repositorio
- **Status**: done
- **Files**: `packages/cli/commands/ui.script.ts`, `tests/cli/compiled-binary.test.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: none
- acceptance:
  - "El binario arranca con UI integrada fuera del repositorio."
  - "El binario sirve un directorio estático explícito."
  - "La autodetección en checkout sigue funcionando."
- shipped-in: `4dd1374feed8`
- review-state: done
- review-implementer: openai-gpt-6.1-terra
- review-reviewer: openai-gpt-6.2-sol
- review-log: approved by openai-gpt-6.2-sol — verified at 4961ed70795d, validate exit 0 and tests 11/11 claimed, no recorded run cited; acceptance 3/3: (1) Binario en cwd temporal y PATH=/usr/bin:/bin: arrancó en loopback y GET / devolvió 200 con título Tanit. Regresión compilada aprobada. (2) Prueba compilada con directorio explícito y Chromium usando build Angular de producción: Diagnósticos, previsualización textual exacta y conservación del infor… (3) En cwd externo, el comando fuente en checkout sin --static-dir detectó packages/app/dist, sirvió Angular con HTTP 200 e inyectó token de la Application API. — Revisión independiente del exacto PR #190, CI 44552281838 verde. Las pruebas ejecutadas desde develop de00f9a0 comparten exactamente ambos ficheros del PR: 11/11 en tres ficheros. Se repitieron además fallback real sin Bun, Chromium aislado y autodetección fuente.

## acceptance

- El binario arranca con UI integrada fuera del repositorio.
- El binario sirve un directorio estático explícito.
- La autodetección en checkout sigue funcionando.
