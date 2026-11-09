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
shipped-in:
  - "44a9237b01db93db8f15bc57e734c4ae2b9de684"
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
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at 44a9237b01db, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 4/4: (1) Reviewed destination resolution in export.handler.ts and tests/core/export-destination.spec.ts plus the e2e handler test. (2) Reviewed relative path resolution in export-artifacts.helper.ts and destination regression coverage. (3) Reviewed export response construction and persisted-history/destination assertions for written files. (4) Reviewed dry-run/export shared artifact-selection helper and parity tests. — Independent review at landed develop source 44a9237b01db93db8f15bc57e734c4ae2b9de684. Reused actual governed validation from the prior review unit: exit 0, 4917 Vitest + 15 SQLite + 41 transport = 4973/4975, two platform skips; journal timestamp 2026-11-09T15:37:21.268Z at the prior unit path .cache/delendai/results/logs/validate.jsonl. It was not rerun in this unit. Tracked source diff from validated 3e02acdb to this snapshot is empty outside proposal metadata. Fresh lint:docs and lint:proposals both pass. Independent source review; no changes requested.

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
