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

- TODO: what this proposal deliberately skips.

## slices

- global_gate: e2e

### S1 — Unificar preparación y escritura
- **Status**: pending
- **Files**: `packages/cli/commands/generate.script.ts`, `packages/core/application-api/export-artifacts.helper.ts`, `packages/ui/server/routes`
- **Gate**: e2e
- acceptance:
  - "Mismas opciones producen los mismos artefactos por CLI y Application API."
  - "Enriquecimiento y selección viven en un servicio común."

### S2 — Historial persistente común
- **Status**: pending
- **Files**: `packages/core/history`, `packages/cli/commands/history.script.ts`, `packages/ui/server/history.service.ts`, `packages/contracts/interfaces/core`
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
