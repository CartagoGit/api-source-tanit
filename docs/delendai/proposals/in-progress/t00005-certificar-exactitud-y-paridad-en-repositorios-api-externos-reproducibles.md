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

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — Corpus y baseline externo
- **Status**: pending
- **Files**: `tests/acceptance/external-corpus`, `scripts/gates/acceptance-external.script.ts`, `docs/BETA.md`
- **Gate**: e2e
- acceptance:
  - "Corpus público con licencias, revisiones fijadas y expectativas revisadas manualmente; sin ejecutar servidores o scripts de instalación de terceros."
  - "Medir precisión y recall de endpoints por framework y exactitud de respuestas/schemas por separado; no presentar desconocidos como correctos."
  - "CLI y Application API generan el mismo resultado semántico sobre cada muestra; publicar evidencia reproducible y limitaciones."

## acceptance

- Corpus público con licencias, revisiones fijadas y expectativas revisadas manualmente; sin ejecutar servidores o scripts de instalación de terceros.
- Medir precisión y recall de endpoints por framework y exactitud de respuestas/schemas por separado; no presentar desconocidos como correctos.
- CLI y Application API generan el mismo resultado semántico sobre cada muestra; publicar evidencia reproducible y limitaciones.
