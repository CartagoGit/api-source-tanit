---
id: d00005
title: "Consultar el catálogo vivo de herramientas Tanit"
kind: docs
status: done
type: proposal
track: general
date: 2026-11-19
last-transition-id: 2cfc1f7c-953d-4ee0-8005-2ce2f1f9fb05
last-correlation-id: 2cfc1f7c-953d-4ee0-8005-2ce2f1f9fb05
last-transition-from: review
last-transition-at: 2026-11-19T15:25:59.128Z
shipped-in:
  - "fa64a8055c30e066ec0990f1e6fa40d30c5a342c"
---

# d00005 — Consultar el catálogo vivo de herramientas Tanit

## goal

Eliminar la tabla obsoleta y documentar el nombre derivado y el catálogo vivo.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: lint

### S1 — Actualizar nombres de herramientas
- **Status**: done
- **Files**: `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: none
- acceptance:
  - "La sección 3.1 enlaza el registro y remite al catálogo vivo sin inventario fijo."
  - "La identidad DelendAI:Tanit permanece sin cambios."
- shipped-in: `5567e8156c38`
- review-state: done
- review-implementer: openai-gpt-6.1-terra
- review-reviewer: openai-gpt-6.1-sol
- review-log: approved by openai-gpt-6.1-sol — verified at fa64a8055c30, validate exit 0 and tests 15/15 claimed, no recorded run cited; acceptance 2/2: (1) Diff 5567e815 elimina tabla y excepción; enlace relativo válido al index.ts; activate tanit + tools/list stdio devuelve 10 registros reales. (2) §3.7 conserva identidad y diff de configs .mcp.json/.vscode/mcp.json vacío en fa64a805. — Diff 5567e815 y #183 99a2a59a; entrega integrada fa64a805. §3.1 enlaza registro y remite a activar tanit y catálogo vivo sin inventario. Reproduje stdio DelendAI 0.3.0, activé tanit y tools/list devolvió 10 herramientas calificadas; la guía funciona. Identidad DelendAI:Tanit en §3.7 y configs no cambiada. CI exacta 44483744253 success; conteos 15/15 citados del subgrupo SQLite del log, no total global ni ejecución local. Gate none. 717ee23b es cambio posterior del bootstrap ajeno a §3.1.

## acceptance

- La sección 3.1 enlaza el registro y remite al catálogo vivo sin inventario fijo.
- La identidad DelendAI:Tanit permanece sin cambios.
