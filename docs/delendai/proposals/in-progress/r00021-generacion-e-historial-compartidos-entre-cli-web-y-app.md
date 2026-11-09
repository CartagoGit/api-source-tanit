---
id: r00021
title: "Generación e historial compartidos entre CLI, web y app"
kind: refactor
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: 45a7b241-543b-4693-ba3e-f0fcf52021b9
last-correlation-id: 45a7b241-543b-4693-ba3e-f0fcf52021b9
last-transition-from: ready
last-transition-at: 2026-11-09T01:38:37.947Z
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
- **Files**: `packages/cli/commands/generate.script.ts`, `packages/core/application-api/export-artifacts.helper.ts`, `packages/core/exporters/export-files.service.ts`, `packages/core/discovery/discovery.orchestrator.ts`, `packages/core/discovery/generation.pipeline.ts`, `packages/contracts/interfaces/core/discovery.interface.ts`, `packages/contracts/interfaces/core/scanner.interface.ts`, `packages/contracts/interfaces/core/export-files.interface.ts`, `packages/frameworks/framework.registry.ts`, `packages/frameworks/generation-preparation.service.ts`, `tests/core/export-files.service.spec.ts`, `tests/e2e/cli-api-export-parity.spec.ts`, `docs/API.md`
- **Gate**: e2e
- acceptance:
  - "Mismas opciones producen los mismos artefactos por CLI y Application API."
  - "Enriquecimiento y selección viven en un servicio común."

### S2 — Historial persistente común
- **Status**: pending
- **Files**: `packages/core/session/project-history.service.ts`, `packages/cli/commands/history.script.ts`, `packages/ui/server/history.service.ts`, `packages/contracts/interfaces/core/history.interface.ts`
- **Gate**: e2e
- acceptance:
  - "La misma ejecución aparece en CLI y app con identidad común."
  - "La lectura del historial no requiere reescanear."
  - "La migración de history.jsonl conserva registros y evita duplicados."

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
