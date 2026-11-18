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
shipped-in:
  - "05aab32c592366603a93e6a3d678252a996f1a8f"
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
- **Status**: done
- **Files**: `tests/acceptance/external-corpus`, `scripts/gates/acceptance-external.script.ts`, `scripts/helpers/external-corpus.helper.ts`, `tests/scripts-gates/external-corpus.spec.ts`, `packages/contracts/interfaces/runtime.d.ts`, `docs/BETA.md`, `docs/delendai/AGENT-BOOTSTRAP.md`, `docs/delendai/proposals/INDEX.md`
- **Gate**: e2e
- acceptance:
  - "Corpus público con licencias, revisiones fijadas y expectativas revisadas manualmente; sin ejecutar servidores o scripts de instalación de terceros."
  - "Medir precisión y recall de endpoints por framework y exactitud de respuestas/schemas por separado; no presentar desconocidos como correctos."
  - "CLI y Application API generan el mismo resultado semántico sobre cada muestra; publicar evidencia reproducible y limitaciones."
- shipped-in: `5fecc9d2388f`
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6
- review-log: approved by openai-gpt-6 — verified at 05aab32c5923, validate exit 0 and tests 15/15 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed pinned MIT license evidence and route/mount sources for both public revisions; independently materialized 52 Express and 113 Laravel SHA-256 verified … (2) Fresh compiled CLI and actual API: Express 20/20 and Laravel 21/21, precision/recall 1, no missing/unexpected/duplicates. Response/schema claims separately rem… (3) Independent offline runs from compiled /tmp/tanit-review-openai-gpt-6-t00005-cli produce semanticParity=true and contractsParity=true on both real pinned sampl… — Independent acceptance at 05aab32c592366603a93e6a3d678252a996f1a8f. Corpus spec 15/15 exit 0; own compiled CLI and actual Application API runner passed Express 20/20 and Laravel 21/21 with both parity verdicts true, unknown claims unchanged. Official delendai work prove returned proved:true exit 0 before review. Counts directly observed/reviewer-reported, no journal runId claimed. Static-only scope; no live HTTP or complete response/schema/beta certification.

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
