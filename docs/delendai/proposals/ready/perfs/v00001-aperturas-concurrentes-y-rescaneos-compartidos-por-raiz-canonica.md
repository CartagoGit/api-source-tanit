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

- Cambios de presentación o transporte Live; esta propuesta mantiene los servicios de sesión compartidos.
- Canonicalización mediante realpath o cwd implícito; la normalización conserva raíces léxicas portables.

## slices

- global_gate: e2e

### S1 — Apertura en curso compartida
- **Status**: done
- **Files**: `packages/core/session/project-session.service.ts`, `tests/core/session/session-opening.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Dos aperturas simultáneas de la misma raíz comparten sesión y un scan."
  - "Los fallos liberan la apertura en curso y permiten reintentar."
  - "Raíces distintas permanecen aisladas."

### S2 — Coalescer cambios y excluir salidas
- **DependsOn**: [S1]
- **Status**: done
- **Files**: `packages/core/session/project-session.service.ts`, `packages/contracts/constants/core/session.constant.ts`, `packages/contracts/interfaces/core/session.interface.ts`, `packages/core/session/session-events.ts`, `tests/core/session/session-rescan.spec.ts`
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

## Implementation evidence

- S1 shares in-flight openings by normalized root, removes failed openings for retry and prevents cancelled scans from publishing a late session. Different roots remain isolated.
- S2 serializes configuration scans and watcher rescans in one execution lane, consolidates pending paths, excludes output/dependency noise and discards obsolete candidates.
- Watcher failures emit typed `snapshot-error` events and preserve the previous valid snapshot; observation can recover on a later change.
- Implementation commits: `ed6f7fe3` (S1) and `ee2d0ec2` (S2). The full delivery gate certifies their combined candidate before publication.
