---
id: x00088
title: "Auto-merge real de PR con permisos correctos y fallos visibles"
kind: fix
status: review
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: ba4aedc4-9b3e-43e3-910a-3f050318b559
last-correlation-id: ba4aedc4-9b3e-43e3-910a-3f050318b559
last-transition-from: in-progress
last-transition-at: 2026-11-08T21:05:20.054Z
shipped-in:
  - "44a9237b01db93db8f15bc57e734c4ae2b9de684"
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
- shipped-in: `75ce8128a77e`
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at 44a9237b01db, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 4/4: (1) Reviewed .github/workflows/auto-approve.yml and workflow contract regression test for owner job permissions. (2) Reviewed the workflow mutation payload and tests/scripts-gates/auto-merge-workflow.spec.ts for expected head and merge method. (3) Reviewed CLI/workflow error handling tests for a rejected GitHub mutation failing the job. (4) Reviewed workflow trigger filters and auto-approve CLI regression tests for author/draft checks and post-CI approval. — Independent review at landed develop source 44a9237b01db93db8f15bc57e734c4ae2b9de684. Reused actual governed validation from the prior review unit: exit 0, 4917 Vitest + 15 SQLite + 41 transport = 4973/4975, two platform skips; journal timestamp 2026-11-09T15:37:21.268Z at the prior unit path .cache/delendai/results/logs/validate.jsonl. It was not rerun in this unit. Tracked source diff from validated 3e02acdb to this snapshot is empty outside proposal metadata. Fresh lint:docs and lint:proposals both pass. Independent source review; no changes requested.

## acceptance

- El job propietario tiene permisos de contents:write y pull-requests:write.
- La solicitud usa enablePullRequestAutoMerge con expectedHeadOid y MERGE.
- El job falla cuando GitHub rechaza la operación.
- Los filtros de autor/borrador y la aprobación posterior a CI se conservan.

## Validation evidence

- Executed the actual workflow script against fake GitHub responses: guarded MERGE mutation succeeds, API rejection propagates.
- Owner/draft/green-CI conditions and write permissions asserted; eight workflow tests pass.
- CLI typecheck and contracts/types gates pass.
