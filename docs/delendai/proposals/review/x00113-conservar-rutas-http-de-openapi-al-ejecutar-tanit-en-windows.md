---
id: x00113
title: "Conservar rutas HTTP de OpenAPI al ejecutar Tanit en Windows"
kind: fix
status: review
type: proposal
track: beta
date: 2026-11-19
last-transition-id: 20cc0e1e-60e5-4201-9ae5-0d9c45fd1091
last-correlation-id: 20cc0e1e-60e5-4201-9ae5-0d9c45fd1091
last-transition-from: in-progress
last-transition-at: 2026-11-19T22:48:34.095Z
---

# x00113 — Conservar rutas HTTP de OpenAPI al ejecutar Tanit en Windows

## goal

Mantener URLs y agrupación de exportación independientes del separador del sistema de archivos.

## why

Los binarios nativos 9e75e663 exportan /api/users en Linux y /\api\users en Windows, con carpetas Postman distintas.

## non-goals

- Cambiar las rutas de disco ni publicar una versión.

## slices

- global_gate: lint

### S1 — Resolver rutas OpenAPI con la misma semántica HTTP en ambos sistemas
- **Status**: review
- **Files**: `packages/frameworks/scanners/openapi.scanner.ts`, `packages/contracts/interfaces/runtime.d.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "El fixture OpenAPI exporta las mismas rutas HTTP y la misma agrupación de Postman con binarios nativos Linux y Windows."
  - "El scanner conserva la interpretación de basePath, servers, barras y referencias ya cubierta por pruebas."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `b841d22affcc`

## acceptance

- El fixture OpenAPI exporta las mismas rutas HTTP y la misma agrupación de Postman con binarios nativos Linux y Windows.
- El scanner conserva la interpretación de basePath, servers, barras y referencias ya cubierta por pruebas.
