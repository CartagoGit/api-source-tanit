---
id: v00001
title: "Aperturas concurrentes y rescaneos compartidos por raíz canónica"
kind: perf
status: review
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: 66ba0f8d-f43e-4f46-a9fb-e378773cc592
last-correlation-id: 66ba0f8d-f43e-4f46-a9fb-e378773cc592
last-transition-from: in-progress
last-transition-at: 2026-11-09T01:33:49.142Z
shipped-in:
  - "bebadb7005b46141961d4924c96e8a97268ad2d5"
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
- shipped-in: `ee2d0ec2e589`
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at bebadb7005b4, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed project-session open coalescing and tests/core/session/session-opening.spec.ts for concurrent callers sharing one in-flight open/scan. (2) Reviewed opening failure cleanup and retry cases in tests/core/session/session-opening.spec.ts. (3) Reviewed canonical root scoping and distinct-root isolation cases in the session opening tests. — Independent review at landed develop snapshot bebadb7005b46141961d4924c96e8a97268ad2d5. Reused the actual governed validation from the previous review unit: exit 0, 4917 Vitest + 15 SQLite + 41 transport = 4973/4975, two platform skips; journal timestamp 2026-11-09T15:37:21.268Z at the prior unit path .cache/delendai/results/logs/validate.jsonl. It was not rerun in G4. Tracked source diff from validated 3e02acdb to this snapshot is empty outside proposal metadata. Fresh lint:docs and lint:proposals pass. Independent source review; no changes requested.

### S2 — Coalescer cambios y excluir salidas
- **DependsOn**: [S1]
- **Status**: done
- **Files**: `packages/core/session/project-session.service.ts`, `packages/contracts/constants/core/session.constant.ts`, `packages/contracts/interfaces/core/session.interface.ts`, `packages/core/session/session-events.ts`, `tests/core/session/session-rescan.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Una ráfaga termina con el snapshot de la última fuente sin scans concurrentes."
  - "Escribir artefactos o dependencias no inicia bucles."
  - "Errores de watcher se publican como diagnósticos."
- shipped-in: `ee2d0ec2e589`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

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
