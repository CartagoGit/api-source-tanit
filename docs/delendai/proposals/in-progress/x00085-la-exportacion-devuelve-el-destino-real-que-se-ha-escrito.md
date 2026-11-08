---
id: x00085
title: "La exportación devuelve el destino real que se ha escrito"
kind: fix
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: 3e5b7330-9d72-44a3-9f22-2762c26fe67c
last-correlation-id: 3e5b7330-9d72-44a3-9f22-2762c26fe67c
last-transition-from: ready
last-transition-at: 2026-11-08T13:36:21.193Z
---

# x00085 — La exportación devuelve el destino real que se ha escrito

## goal

Una única resolución de destino gobierna preview, export y sync; el resultado describe archivos reales.

## why

export.handler.ts toma dirname(outputPath) para escribir con un nombre generado y devuelve el nombre solicitado aunque no exista.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: e2e

### S1 — Resolver y devolver el destino real
- **Status**: done
- **Files**: `packages/core/application-api/export.handler.ts`, `packages/core/application-api/export-artifacts.helper.ts`, `packages/core/application-api/dry-run.handler.ts`, `packages/core/application-api/sync.handler.ts`, `packages/core/application-api/history-persisted.handlers.ts`, `packages/contracts/constants/core/application-api.constant.ts`, `tests/application-api/export.handler.spec.ts`, `tests/application-api/persisted-history.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Nombre y directorio personalizados coinciden con el archivo escrito."
  - "Las rutas relativas se resuelven explícitamente."
  - "El resultado sólo enumera archivos existentes."
  - "Preview y export usan la misma selección de artefactos."

## acceptance

- Nombre y directorio personalizados coinciden con el archivo escrito.
- Las rutas relativas se resuelven explícitamente.
- El resultado sólo enumera archivos existentes.
- Preview y export usan la misma selección de artefactos.

## Validation evidence

- 78 focused tests and all six typecheck sections passed before delivery preparation.
- Relative project-root parity covers preview, export, sync and history re-export.
- Public preview/sync schemas accept the same custom outputPath as export.
- Multi-file exporters reject a single filename before writing and preserve their directory layout.
