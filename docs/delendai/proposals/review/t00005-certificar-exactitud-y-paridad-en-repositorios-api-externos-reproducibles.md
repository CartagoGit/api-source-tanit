---
id: t00005
title: "Certificar exactitud y paridad en repositorios API externos reproducibles"
kind: test
status: review
type: proposal
track: beta
date: 2026-11-10
last-transition-id: 1875380a-c828-44df-97ae-5e65efc02e4b
last-correlation-id: 1875380a-c828-44df-97ae-5e65efc02e4b
last-transition-from: in-progress
last-transition-at: 2026-11-18T08:17:20.053Z
---

# t00005 — Certificar exactitud y paridad en repositorios API externos reproducibles

## goal

Medir detección y contratos en revisiones inmutables de proyectos de terceros antes de ampliar la beta.

## why

La beta técnica actual verifica ejemplos Express y Laravel; aún no mide precisión/recall externos. Las notas cualitativas del informe externo no son métricas.

## non-goals

- Ejecutar servidores, instalar dependencias o ejecutar scripts de los repositorios de terceros.
- Certificar comportamiento HTTP en vivo o exactitud completa a partir de inferencia parcial.
- Introducir dependencias de DelendAI en el producto.

## slices

- global_gate: none

### S1 — Corpus y baseline externo
- **Status**: review
- **Files**: `tests/acceptance/external-corpus`, `scripts/gates/acceptance-external.script.ts`, `scripts/helpers/external-corpus.helper.ts`, `tests/scripts-gates/external-corpus.spec.ts`, `packages/contracts/interfaces/runtime.d.ts`, `docs/BETA.md`, `docs/delendai/AGENT-BOOTSTRAP.md`, `docs/delendai/proposals/INDEX.md`
- **Gate**: e2e
- acceptance:
  - "Corpus público con licencias, revisiones fijadas y expectativas revisadas manualmente; sin ejecutar servidores o scripts de instalación de terceros."
  - "Medir precisión y recall de endpoints por framework y exactitud de respuestas/schemas por separado; no presentar desconocidos como correctos."
  - "CLI y Application API generan el mismo resultado semántico sobre cada muestra; publicar evidencia reproducible y limitaciones."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `5fecc9d2388f`

## acceptance

- Corpus público con licencias, revisiones fijadas y expectativas revisadas manualmente; sin ejecutar servidores o scripts de instalación de terceros.
- Medir precisión y recall de endpoints por framework y exactitud de respuestas/schemas por separado; no presentar desconocidos como correctos.
- CLI y Application API generan el mismo resultado semántico sobre cada muestra; publicar evidencia reproducible y limitaciones.


## Evidence

The preserved Express and Laravel revisions produce 20/20 and 21/21
expected routes respectively through the actual CLI and Application API.
Their Postman semantics and OpenAPI contracts agree across carriers. The
Laravel manifest excludes the four localization catalogs in
`resources/lang/`. Running the same pinned revision with and without
those catalogs yielded identical routing measurements, parity verdicts
and response/schema claims. All 113 copied Laravel files and 52 Express
files remain checked against SHA-256. Unknown response and schema claims
remain explicitly unmeasured.
