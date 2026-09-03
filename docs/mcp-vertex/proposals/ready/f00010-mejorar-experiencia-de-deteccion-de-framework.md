---
id: f00010
title: "feat(ui): explainer de detección + health score + dashboard multi-proyecto (FEAT-001/002/003 + L-U02/L-U03 + I-U01)"
kind: feat
date: 2026-09-03
status: ready
type: proposal
track: export-to-postman
dependsOn:
  - a00009
---

# f00010 — feat(ui): explainer de detección + health score + dashboard multi-proyecto

Esta propuesta agrupa tres features de la auditoría `a00009` (FEAT-001,
FEAT-002, FEAT-003) que comparten infraestructura (la salida del
discovery) y pueden entregarse juntas sin romper el modelo de
despliegue actual.

## Goal

Que el usuario entienda **por qué** se eligió un framework (no solo
**cuál**), vea el estado de salud de su proyecto (% de rutas con
validación, % con body schema, % con ejemplos), y pueda comparar
versiones generadas sin abrir un diff externo.

## Por qué ahora

- `IProjectMatch.score` y `IDetectedFramework.score` ya existen en el
  orquestador: el dato está, solo falta exponerlo.
- `summary` ya devuelve un objeto rico; el coste es darle una cara
  legible.
- El dashboard multi-proyecto se monta sobre `~/.expostman/history.json`
  (no existe todavía; el slice lo crea).

## Diseño de slices

- **S1**: añadir `IDetectionEvidence[]` a `IDetectedFramework` y
  rellenar con los mensajes actuales de los detectores ("`package.json`
  tiene `express` en deps" / "`tsconfig.json` apunta a `next`"). Output
  en `summary` (CLI y tool). Esto es FEAT-002.
- **S2**: nueva sección `IProjectHealth` con % por categoría
  (validación / bodies / examples / descriptions). Computar en
  `summary.service`. Output en `summary`. Esto es FEAT-003.
- **S3**: nueva sección en `index.html.constant.ts` que pinte los dos
  anteriores en formato de tarjeta con emoji + color. Reemplaza la
  lista plana de frameworks actual. Esto cubre la parte UI de
  FEAT-002 y FEAT-003.
- **S4**: `~/.expostman/history.json` — append al generar, lista en
  `dashboard`. Esto es FEAT-001.
- **S5**: tests focalizados para cada uno.

## Slices independientes que pueden salir de f00010

- `f00011` (FEAT-004): diff visual entre exports (slices S1-S3 propios).
- `f00012` (FEAT-008): tutorial / onboarding para nuevos usuarios.
- `f00013` (FEAT-009): detección de proyecto híbrido (dos frameworks
  con score alto → UI muestra los dos y deja al usuario elegir).

## Definition of done

- [ ] `summary` CLI muestra por framework: score, evidencia textual,
      y health score del proyecto.
- [ ] `summary` tool MCP incluye los mismos campos con outputSchema
      derivada.
- [ ] UI web renderiza la sección de evidence + health con estilo
      consistente (sin colores crípticos, con icono).
- [ ] Dashboard multi-proyecto accesible desde la UI raíz.
- [ ] `~/.expostman/history.json` se actualiza al generar y se
      consulta al cargar el dashboard.
- [ ] Tests focalizados para cada slice (≥ 4 tests nuevos).
- [ ] `bun run validate` verde.
- [ ] Commit + push.
