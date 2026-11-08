---
id: x00088
title: "Auto-merge real de PR con permisos correctos y fallos visibles"
kind: fix
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: 1e83fb89-9773-4c38-851b-5abc7356363d
last-correlation-id: 1e83fb89-9773-4c38-851b-5abc7356363d
last-transition-from: ready
last-transition-at: 2026-11-08T20:46:51.605Z
---

# x00088 — Auto-merge real de PR con permisos correctos y fallos visibles

## goal

Una PR del dueño con CI verde activa auto-merge de GitHub con merge commit y control del SHA; los errores dejan el job en rojo.

## why

PR116 quedó abierta con todos los checks verdes y autoMergeRequest nulo: el workflow usa un flag REST no soportado, contents:read y captura el error como warning exitoso.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: e2e

### S1 — Usar la mutación oficial y validar el contrato del workflow
- **Status**: done
- **Files**: `.github/workflows/auto-approve.yml`, `tests/scripts-gates/auto-merge-workflow.spec.ts`, `tests/cli/auto-approve.spec.ts`
- **Gate**: e2e
- acceptance:
  - "El job propietario tiene permisos de contents:write y pull-requests:write."
  - "La solicitud usa enablePullRequestAutoMerge con expectedHeadOid y MERGE."
  - "El job falla cuando GitHub rechaza la operación."
  - "Los filtros de autor/borrador y la aprobación posterior a CI se conservan."

## acceptance

- El job propietario tiene permisos de contents:write y pull-requests:write.
- La solicitud usa enablePullRequestAutoMerge con expectedHeadOid y MERGE.
- El job falla cuando GitHub rechaza la operación.
- Los filtros de autor/borrador y la aprobación posterior a CI se conservan.

## Validation evidence

- Executed the actual workflow script against fake GitHub responses: guarded MERGE mutation succeeds, API rejection propagates.
- Owner/draft/green-CI conditions and write permissions asserted; eight workflow tests pass.
- CLI typecheck and contracts/types gates pass.
