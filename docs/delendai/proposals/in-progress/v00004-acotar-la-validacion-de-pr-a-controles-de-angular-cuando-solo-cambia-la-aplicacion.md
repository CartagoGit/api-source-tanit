---
id: v00004
title: "Acotar la validación de PR a controles de Angular cuando solo cambia la aplicación"
kind: perf
status: in-progress
type: proposal
track: quality
date: 2026-11-20
---

# v00004 — Acotar la validación de PR a controles de Angular cuando solo cambia la aplicación

## goal

Los cambios Angular que podemos delimitar ejecutan pruebas de la app, cobertura medida, compilación AOT y los controles comunes de integración.

## why

El plan actual marca cualquier archivo Angular como no medible y lanza el CI completo, incluidos SDK y pruebas Rust, aunque el único cambio sea TypeScript de presentación o estado.

## non-goals

- Cambiar los umbrales, auditoría o jobs exigidos a las integraciones y promociones.
- Acotar recursos Angular, puentes nativos o cambios mixtos sin un grafo validado.

## slices

- global_gate: lint

### S1 — Seleccionar y ejecutar una prueba Angular medible
- **Status**: pending
- **Files**: `scripts/gates/coverage-policy.constant.ts`, `scripts/gates/changed-file-coverage.script.ts`, `scripts/gates/prove.script.ts`, `scripts/helpers/proof-plan.helper.ts`, `tests/scripts-gates/changed-file-coverage.spec.ts`, `tests/scripts-gates/proof-plan.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "Un cambio delimitado de TypeScript de estado o presentación selecciona exclusivamente las pruebas Angular, sus tipos y el build AOT, además de lint y verificación de integración."
  - "El informe mide los archivos cambiados y los totales Angular contra una base medida. Si falta cobertura, el job falla. Los umbrales de otras secciones siguen igual."
  - "Cambios mixtos, globales, estructurales o de alcance incierto e integraciones y promociones conservan la validación completa."

## acceptance

- Un cambio delimitado de TypeScript de estado o presentación selecciona exclusivamente las pruebas Angular, sus tipos y el build AOT, además de lint y verificación de integración.
- El informe mide los archivos cambiados y los totales Angular contra una base medida. Si falta cobertura, el job falla. Los umbrales de otras secciones siguen igual.
- Cambios mixtos, globales, estructurales o de alcance incierto e integraciones y promociones conservan la validación completa.
