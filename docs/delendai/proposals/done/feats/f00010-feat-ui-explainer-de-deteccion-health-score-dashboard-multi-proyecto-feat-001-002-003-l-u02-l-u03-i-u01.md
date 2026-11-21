---
id: f00010
title: "feat(ui): explainer de detección + health score + dashboard multi-proyecto (FEAT-001/002/003 + L-U02/L-U03 + I-U01)"
kind: feat
status: done
type: proposal
track: export-to-postman
date: 2026-09-03
closed: 2026-09-03
shippedIn:
  - 42bb339
  - acf1c2e
  - 957bebe
  - f1298fc
  - 9ea4da6
  - 1f526e8
  - ce9c141
  - 0da42da
  - cad24f3
  - bd685ee
  - 382a7b7
  - e2c8ea8
dependsOn:
  - a00009
---

> **Cerrada 2026-09-03.** Los 5 slices de la propuesta f00010 quedaron
> cerrados sobre `develop`. El `bun run validate` corrió verde y empujó
> con todos los gates limpios.

# f00010 — feat(ui): explainer + health score + dashboard

Esta propuesta agrupa tres features de la auditoría `a00009` (FEAT-001,
FEAT-002, FEAT-003) que comparten infraestructura (la salida del
discovery) y se entregan juntas sin romper el modelo de despliegue.

## Slices cerrados

| Slice | Entrega | Commit(s) clave |
|---|---|---|
| **S1** IDetectionEvidence en summary | Evidence legible en `summary` CLI/tool; los 20 project scanners emiten `signal/weight/artifact` | `42bb339`, `acf1c2e`, `957bebe`, `ce9c141` |
| **S2** IProjectHealth | Cuatro categorías (% con validación, % con body, % con ejemplos, % con descripciones) | `1f526e8` |
| **S3** Tarjeta visual UI | Sección `#deteccion` con dos bloques (`#evidencia` + `#salud`); estilos accesibles | `cad24f3`, `382a7b7` |
| **S4** Dashboard multi-proyecto | Subcomando `expostman history`, ruta HTTP `/api/history`, persistencia `~/.expostman/history.jsonl` con `appendFileAtomic` | `bd685ee`, `0da42da` |
| **S5** Tests focalizados | `tests/cli/health-summary.spec.ts` (9), `tests/cli/evidence-summary.spec.ts` (7), `tests/cli/dashboard.spec.ts` (12), `tests/cli/ui-detection.spec.ts` (10) | `382a7b7`, `e2c8ea8` |

## Definition of done — estado

- [x] `summary` CLI muestra por framework: score, evidencia textual y
      health score del proyecto.
- [x] `summary` tool MCP incluye los mismos campos con `outputSchema`
      derivada (`SummaryOutputSchema` con `evidence: IProjectDetectionEvidence[]`).
- [x] UI web renderiza evidence + health con emoji + `%` textual
      (cumple WCAG 1.4.1: el estado nunca va solo por color).
- [x] Dashboard multi-proyecto accesible desde la UI raíz.
- [x] `~/.expostman/history.jsonl` se actualiza al generar y se
      consulta al cargar el dashboard.
- [x] Tests focalizados para cada slice (38 tests nuevos en `tests/cli/`).
- [x] `bun run validate` verde (147 archivos, 2987 tests pasan,
      cobertura 83.65/72.42/87.67/85.64).
- [x] Commit + push a `develop`.

## Estado final del repo

`develop` está en `e2c8ea8` con todos los commits pusheados a
`origin/develop`. Las propuestas restantes en `ready/` son únicamente
las de este mismo lote paralelo (`f00011`).
