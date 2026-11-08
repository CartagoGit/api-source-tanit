---
id: v00001
title: "Aperturas concurrentes y rescaneos compartidos por raíz canónica"
kind: perf
status: ready
type: proposal
track: api-source-tanit
date: 2026-11-08
---

# v00001 — Aperturas concurrentes y rescaneos compartidos por raíz canónica

## goal

Abrir un proyecto concurrentemente realiza un solo escaneo y las ráfagas de cambios se consolidan sin carreras.

## why

openSession registra la sesión después de esperar el scan; dos aperturas crean sesiones y escaneos duplicados. El watcher recursivo incluye salidas y dependencias y permite rescaneos solapados.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: e2e

### S1 — Apertura en curso compartida
- **Status**: pending
- **Files**: `packages/core/session/project-session.service.ts`, `tests/core/project-session.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Dos aperturas simultáneas de la misma raíz comparten sesión y un scan."
  - "Los fallos liberan la apertura en curso y permiten reintentar."
  - "Raíces distintas permanecen aisladas."

### S2 — Coalescer cambios y excluir salidas
- **Status**: pending
- **Files**: `packages/core/session/project-session-watcher.service.ts`, `tests/core/project-session-watcher.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Una ráfaga termina con el snapshot de la última fuente sin scans concurrentes."
  - "Escribir artefactos o dependencias no inicia bucles."
  - "Errores de watcher se publican como diagnósticos."

## acceptance

- Dos aperturas simultáneas de la misma raíz comparten sesión y un scan.
- Los fallos liberan la apertura en curso y permiten reintentar.
- Raíces distintas permanecen aisladas.
- Una ráfaga termina con el snapshot de la última fuente sin scans concurrentes.
- Escribir artefactos o dependencias no inicia bucles.
- Errores de watcher se publican como diagnósticos.
