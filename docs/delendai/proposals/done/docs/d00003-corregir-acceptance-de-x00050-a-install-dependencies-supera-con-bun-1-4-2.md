---
id: d00003
title: "corregir acceptance de x00050 a Install dependencies supera con Bun 1.4.2"
kind: docs
status: done
type: proposal
track: general
date: 2026-09-06
last-transition-id: d00003-done-retry2
shippedIn:
  - a1e8ad8
last-correlation-id: affair-2026-09-06-d00003-done-retry2
last-transition-from: review
last-idempotency-key: affair-2026-09-06-d00003-done-retry2
---

# d00003 — corregir acceptance de x00050 a Install dependencies supera con Bun 1.4.2

## Goal

La propuesta x00050 fue archivada como done con aceptación CI de develop vuelve a verde, pero el run del SHA shippedIn (9043822) terminó en failure. Corregir la aceptación para que coincida con la realidad verificable.

## why

La revisión 2026-09-06 señaló que la aceptación final de x00050 (CI de develop vuelve a verde) no se cumplió: el commit shippedIn fue 9043822, que terminó en failure con Install dependencies pasando pero Validate fallando. La evidencia del commit afirma CI verde, lo cual es objetivamente falso. El fix subyacente (Bun 1.4.2) es correcto y útil, pero el alcance documentado está exagerado.

## non-goals

- Reabrir `x00050` — la fix de Bun 1.4.2 sigue siendo correcta; solo se ajusta el lenguaje.
- Tocar el cuerpo de `x00050` (queda como referencia histórica; solo el frontmatter se corrige).

## Slices

- global_gate: none

### S1 — docs(proposals): x00050 acceptance — Install dependencies supera con Bun 1.4.2
- **Status**: done
- **Files**: `docs/delendai/proposals/done/fixes/x00050-ci-roja-bun-1-3-no-lee-lockfile-v2-el-pin-de-la-ci-debe-seguir-al-lockfile.md`
- **Gate**: none
- review-state: done
- review-implementer: orchestrator
- review-reviewer: delivery-verifier
- review-log: approved by delivery-verifier — Single-agent auto-review. a1e8ad8 corrige el frontmatter acceptance de x00050 para reflejar exactamente la evidencia empírica verificable (Install dependencies pasa con Bun 1.4.2; gate lint:bun-ci exige bun-version >= lockfileVersion). Validate pasa 3216/3216.
## acceptance

- El frontmatter `acceptance` de `x00050` refleja exactamente la evidencia empírica: CI supera `Install dependencies` con Bun 1.4.2; pinneado en workflows+Dockerfile; gate `lint:bun-ci` exige `bun-version ≥ lockfileVersion`.
