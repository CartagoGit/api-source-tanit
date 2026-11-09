---
id: x00085
title: "La exportación devuelve el destino real que se ha escrito"
kind: fix
status: review
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: de8a7cc7-44df-4cef-95f1-2233da6b4d77
last-correlation-id: de8a7cc7-44df-4cef-95f1-2233da6b4d77
last-transition-from: in-progress
last-transition-at: 2026-11-09T01:32:19.823Z
---

# x00085 — La exportación devuelve el destino real que se ha escrito

## goal

Una única resolución de destino gobierna preview, export y sync; el resultado describe archivos reales.

## why

export.handler.ts toma dirname(outputPath) para escribir con un nombre generado y devuelve el nombre solicitado aunque no exista.

## non-goals

- No cambiar el contenido ni los formatos de los artefactos; este trabajo centraliza la resolución del destino y verifica que el resultado corresponda a archivos escritos.

## slices

- global_gate: e2e

### S1 — Resolver y devolver el destino real
- **Status**: done
- **Files**: `packages/core/application-api/export.handler.ts`, `packages/core/application-api/export-artifacts.helper.ts`, `packages/core/application-api/dry-run.handler.ts`, `packages/core/application-api/sync.handler.ts`, `packages/core/application-api/history-persisted.handlers.ts`, `packages/contracts/constants/core/application-api.constant.ts`, `tests/core/export-destination.spec.ts`, `tests/e2e/export-destination-handler.spec.ts`, `tests/application-api/persisted-history.spec.ts`, `docs/API.md`
- **Gate**: e2e
- acceptance:
  - "Nombre y directorio personalizados coinciden con el archivo escrito."
  - "Las rutas relativas se resuelven explícitamente."
  - "El resultado sólo enumera archivos existentes."
  - "Preview y export usan la misma selección de artefactos."
- shipped-in: `f1c436e8fbe2`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

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
