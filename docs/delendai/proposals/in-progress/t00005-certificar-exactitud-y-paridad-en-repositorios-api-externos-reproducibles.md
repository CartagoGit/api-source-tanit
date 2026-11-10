---
id: t00005
title: "Certificar exactitud y paridad en repositorios API externos reproducibles"
kind: test
status: in-progress
type: proposal
track: beta
date: 2026-11-10
last-transition-id: dde1c3a3-422b-4d4e-8daf-a54fe7ea3771
last-correlation-id: dde1c3a3-422b-4d4e-8daf-a54fe7ea3771
last-transition-from: ready
last-transition-at: 2026-11-10T18:11:00.106Z
---

# t00005 — Certificar exactitud y paridad en repositorios API externos reproducibles

## goal

Medir detección y contratos en revisiones inmutables de proyectos de terceros antes de ampliar la beta.

## why

La beta técnica actual verifica ejemplos Express y Laravel; aún no mide precisión/recall externos. Las notas cualitativas del informe externo no son métricas.

## non-goals

- Ejecutar servidores, instalar dependencias o ejecutar scripts de terceros.
- Confundir inferencias desconocidas con exactitud de schemas certificada.
- Introducir una dependencia DelendAI en el producto.

## slices

- global_gate: none

### S1 — Corpus y baseline externo
- **Status**: pending
- **Files**: `tests/acceptance/external-corpus`, `scripts/gates/acceptance-external.script.ts`, `scripts/helpers/external-corpus.helper.ts`, `tests/scripts-gates/external-corpus.spec.ts`, `packages/contracts/interfaces/runtime.d.ts`, `docs/BETA.md`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "Corpus público con licencias, revisiones fijadas y expectativas revisadas manualmente; sin ejecutar servidores o scripts de instalación de terceros."
  - "Medir precisión y recall de endpoints por framework y exactitud de respuestas/schemas por separado; no presentar desconocidos como correctos."
  - "CLI y Application API generan el mismo resultado semántico sobre cada muestra; publicar evidencia reproducible y limitaciones."

## acceptance

- Corpus público con licencias, revisiones fijadas y expectativas revisadas manualmente; sin ejecutar servidores o scripts de instalación de terceros.
- Medir precisión y recall de endpoints por framework y exactitud de respuestas/schemas por separado; no presentar desconocidos como correctos.
- CLI y Application API generan el mismo resultado semántico sobre cada muestra; publicar evidencia reproducible y limitaciones.


## Implementation scope

The first corpus contains independently reviewed Express (20 operations) and
Laravel (21 operations) RealWorld revisions. Only hashes, route facts and license
references are committed. The offline runner materializes verified source inputs,
compares real CLI and Application API Postman/OpenAPI exports, measures endpoint
precision/recall and reports response/schema claim gaps independently. It does
not certify live HTTP behavior or full schema accuracy from sparse assertions.
A failing external sample is a finding to fix in the scanner, never permission
to change the oracle to fit current output.
