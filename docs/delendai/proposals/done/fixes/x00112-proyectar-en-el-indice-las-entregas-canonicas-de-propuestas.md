---
id: x00112
title: "Proyectar en el índice las entregas canónicas de propuestas"
kind: fix
status: done
type: proposal
track: workflow
date: 2026-11-19
last-transition-id: cc34fa8a-5022-491b-8e1e-3a1253e08f26
last-correlation-id: cc34fa8a-5022-491b-8e1e-3a1253e08f26
last-transition-from: review
last-transition-at: 2026-11-19T20:44:54.880Z
shipped-in:
  - "9b801474d2489138d4497db1e417e84ef608930a"
---

# x00112 — Proyectar en el índice las entregas canónicas de propuestas

## goal

Mostrar los SHAs que DelendAI registra al cerrar propuestas y compartir la lectura con la validación.

## why

El generador del índice solo lee shippedIn y muestra un guion incluso cuando la evidencia shipped-in es válida.

## non-goals

- Cambiar los SHAs registrados o las reglas de validación de DelendAI.

## slices

- global_gate: lint

### S1 — Compartir la lectura de los SHAs entre el índice y el lint
- **Status**: done
- **Files**: `scripts/helpers/proposal-frontmatter.helper.ts`, `scripts/gates/gen-index.script.ts`, `scripts/gates/lint-proposals.script.ts`, `tests/scripts-gates/proposal-frontmatter.spec.ts`, `docs/delendai/proposals/INDEX.md`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: lint
- acceptance:
  - "El índice generado incluye los SHAs de shipped-in canónico y de shippedIn histórico usando el mismo lector que el lint."
  - "El índice canónico se puede comprobar byte por byte y conserva todas las evidencias históricas alcanzables."
- shipped-in: `a52ed4a09e1f`
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6.1-sol
- review-log: approved by openai-gpt-6.1-sol — verified at 9b801474d248, validate exit 0 and tests 9/9 claimed, no recorded run cited; acceptance 2/2: (1) Ambos gates importan helper parseShippedIn; regresión collect/render comprueba ambas claves; focal local 9/9 verde. (2) gen-index --check local igualdad exacta; lint-proposals exit 0 valida 220 propuestas y SHAs alcanzables; diff del INDEX añade evidencias canónicas conservando … — Revisión independiente de a52ed4a0 y entrega #192 9689a82e integrada 9b801474. El parser se extrae literalmente del lint existente a helper puro compartido; gen-index usa parseShippedIn, conserva valores malformados para rechazo y ambas formas históricas/canónicas. Test focal local bunx vitest run tests/scripts-gates/proposal-frontmatter.spec.ts: 9/9 pass exit 0. CLI pinned verificada 0.3.0 f8ab95e8caf66128f8cd18cbf5b3035f74172ba4; gen-index --check confirma igualdad byte por byte sin modificar INDEX; lint-proposals local exit 0: 220 propuestas sin drift, evidencias alcanzables conservadas. Diff a52ed4a0..9b801474 de archivos fuente/spec vacío. CI exacta 44554184499 head 9689a82e success incluye lint, typecheck y test-coverage; no se repite suite global. Solo veredicto, sin producto, INDEX, cierre global ni merge.

## acceptance

- El índice generado incluye los SHAs de shipped-in canónico y de shippedIn histórico usando el mismo lector que el lint.
- El índice canónico se puede comprobar byte por byte y conserva todas las evidencias históricas alcanzables.
