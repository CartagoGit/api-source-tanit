---
id: r00021
title: "Generación e historial compartidos entre CLI, web y app"
kind: refactor
status: review
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: fedc6a2a-9376-4a99-ad20-1499d209de39
last-correlation-id: fedc6a2a-9376-4a99-ad20-1499d209de39
last-transition-from: in-progress
last-transition-at: 2026-11-09T08:16:21.652Z
---

# r00021 — Generación e historial compartidos entre CLI, web y app

## goal

Las interfaces consumen los mismos servicios de preparación de artefactos e historial persistente; sólo cambia su presentación.

## why

generate.script.ts y la web heredada mantienen caminos propios; el CLI usa history.jsonl mientras la app guarda revisiones con ProjectHistoryService.

## non-goals

- No cambiar los formatos de los artefactos ni imponer la misma presentación a cada interfaz.
- S2 mantiene pendiente la unificación y migración del historial persistente; esta entrega implementa S1.

## slices

- global_gate: e2e

### S1 — Unificar preparación y escritura
- **Status**: done
- **Files**: `packages/cli/commands/generate.script.ts`, `packages/core/application-api/export-artifacts.helper.ts`, `packages/core/exporters/export-files.service.ts`, `packages/core/discovery/discovery.orchestrator.ts`, `packages/core/discovery/generation.pipeline.ts`, `packages/contracts/interfaces/core/discovery.interface.ts`, `packages/contracts/interfaces/core/scanner.interface.ts`, `packages/contracts/interfaces/core/export-files.interface.ts`, `packages/frameworks/framework.registry.ts`, `packages/frameworks/generation-preparation.service.ts`, `packages/frameworks/laravel/catalog-enricher.service.ts`, `tests/core/export-files.service.spec.ts`, `tests/e2e/cli-api-export-parity.spec.ts`, `docs/API.md`
- **Gate**: e2e
- acceptance:
  - "Mismas opciones producen los mismos artefactos por CLI y Application API."
  - "Enriquecimiento y selección viven en un servicio común."
- shipped-in: `d5ec9484c46f`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

### S2 — Historial persistente común
- **Status**: done
- **Files**: `packages/core/session/project-history.service.ts`, `packages/core/session/history-run.repository.ts`, `packages/core/session/history-run.service.ts`, `packages/core/session/history-paths.helper.ts`, `packages/core/session/legacy-history.helper.ts`, `packages/core/discovery/generation-summary.helper.ts`, `packages/core/discovery/summary.service.ts`, `packages/core/application-api/history-persisted.handlers.ts`, `packages/contracts/interfaces/core/history.interface.ts`, `packages/contracts/interfaces/core/application-api.interface.ts`, `packages/ui/server/history.service.ts`, `packages/ui/history-paths.helper.ts`, `packages/cli/commands/generate.script.ts`, `packages/cli/commands/summary.script.ts`, `packages/cli/commands/history.script.ts`, `packages/cli/commands/ui.script.ts`, `packages/app/src/app/features/history/history-list.component.html`, `packages/app/src/app/core/i18n/locales`, `tests/e2e/history-authority.spec.ts`, `tests/cli/history.spec.ts`, `tests/cli/dashboard.spec.ts`, `tests/cli/summary-gap-branches.spec.ts`, `tests/cli/ui-deps-branches.spec.ts`, `tests/helpers/history-isolation.setup.ts`, `vitest.config.ts`, `docs/CLI.md`, `docs/API.md`
- **Gate**: e2e
- acceptance:
  - "La misma ejecución aparece en CLI y app con identidad común."
  - "La lectura del historial no requiere reescanear."
  - "La migración de history.jsonl conserva registros y evita duplicados."
- shipped-in: `8565c136c69c`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

## acceptance

- Mismas opciones producen los mismos artefactos por CLI y Application API.
- Enriquecimiento y selección viven en un servicio común.
- La misma ejecución aparece en CLI y app con identidad común.
- La lectura del historial no requiere reescanear.
- La migración de history.jsonl conserva registros y evita duplicados.

## S1 implementation evidence

- CLI generation and Application API share prepared export files and an atomic writer; API adapters translate domain failures without duplicating artifact construction.
- Framework validation enrichment runs through an injected preparation hook before exposing a result to every host. Core does not import framework implementations.
- Preparation validates every requested format before writing, preserves an existing output on exporter failure, and reads file state asynchronously.
- Focused regressions compare Express and Laravel output bytes across every export format, including framework validation variants, and reject malformed Postman artifacts before writing.
- S2 remains pending and no history migration is included in S1.

- Focused validation: 30 tests passed across shared prepared files, CLI/API export parity, destination handler/helper regressions and the generation pipeline. Proposal and generated API-reference gates passed.

- Full-gate regression: shared Laravel preparation exposed duplicate body examples identical to the existing request. The enricher now retains only distinct bodies; all 21 comprehensive Laravel contract cases and CLI/API parity with actual enum variants pass without weakening collection invariants.

## Shared history delivery evidence

- CLI generation now records the actual exported snapshot in the same per-project repository that Application API and app read. Summary commands persist honest metadata-only runs there.
- Old JSONL remains unchanged as a read-only migration input; stable import identities preserve duplicates, malformed-line reporting and repeated reads. A receipt avoids reimport work when the source is unchanged.
- No historical snapshot or hash is fabricated. Metadata-only entries are labeled in EN/ES/FR and disabled for comparison; direct unsupported restore/re-export requests return HISTORY_SNAPSHOT_UNAVAILABLE.
- Two exports from the same snapshot with different destinations/configuration retain distinct record IDs while sharing the canonical source hash.
- Legacy UI facades delegate to core; CLI reads core directly. Pure generation-summary projection is shared, without rescanning on history reads.
- Meaningful integration coverage includes CLI -> API visibility, idempotent migration with duplicates/corruption, shared clear, snapshot absence, and multiple outputs. Ten related suites (101 cases) and six independent typecheck sections pass.
- Tests isolate both current history and legacy migration paths from real user records.
