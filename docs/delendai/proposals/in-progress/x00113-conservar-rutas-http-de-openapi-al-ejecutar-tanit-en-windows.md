---
id: x00113
title: "Conservar rutas HTTP de OpenAPI al ejecutar Tanit en Windows"
kind: fix
status: in-progress
type: proposal
track: beta
date: 2026-11-19
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
- **Status**: pending
- **Files**: `packages/frameworks/scanners/openapi.scanner.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "El fixture OpenAPI exporta las mismas rutas HTTP y la misma agrupación de Postman con binarios nativos Linux y Windows."
  - "El scanner conserva la interpretación de basePath, servers, barras y referencias ya cubierta por pruebas."

## acceptance

- El fixture OpenAPI exporta las mismas rutas HTTP y la misma agrupación de Postman con binarios nativos Linux y Windows.
- El scanner conserva la interpretación de basePath, servers, barras y referencias ya cubierta por pruebas.
