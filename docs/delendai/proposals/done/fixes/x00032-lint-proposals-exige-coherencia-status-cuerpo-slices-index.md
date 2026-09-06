---
id: x00032
title: "lint:proposals debe verificar cuerpo↔frontmatter↔INDEX: done es imposible con slices pendientes"
kind: fix
status: done
type: proposal
track: api-source-tanit
date: 2026-09-05
shippedIn:
  - cff205b
  - 1e77230
  - 3a04800
  - 27edf70
  - 7abe72b
related:
  - a00012
  - i00002
  - x00027
---

# x00032 — El gate de propuestas solo mira el frontmatter: por eso se cierra de más

## Goal

Que `bun run lint:proposals` rechace cualquier propuesta `status: done` cuyo cuerpo todavía contenga slices `**Status**: pending`, o que no esté físicamente bajo `done/<kind>/`, o cuyo `shippedIn` sea distinto de vacío, o que siga listada en la sección Ready de `INDEX.md`.

Hoy el gate solo valida **frontmatter ↔ carpeta**. Con eso en verde, las revisiones de 2026-09-04/05 encontraron cuatro veces la misma incoherencia: propuestas `done` en frontmatter con sus slices `pending` en el cuerpo, y `INDEX.md` desincronizado del filesystem — y la máquina de estados del agente no las frenó.

## Why

El diagnóstico convergente de las tres revisiones: la disciplina de cierre es la parte más débil del agente (5,8/10 vs 8,6 de calidad de código), y el culpable no es solo el agente sino el gate:

- El agente confunde "implementé algo que parece el hallazgo" con "done". El gate actual no puede distinguir esas dos frases porque no mira el cuerpo.
- La apertura de Slice-status es texto libre en el cuerpo; nadie la parsea. Un `**Status**: pending` en una propuesta `done` es una contradicción mecanográficamente detectable.
- `INDEX.md` se mantiene a mano y tiene dos fuentes de verdad (frente al filesystem y frente a los frontmatter) que ya divergieron en el HEAD de las revisiones (listaba `a00014/15/16/b00001` en Ready con las cuatro en `done/`).

La regla que convierte "done" en acceptance demostrada se llama gate: si no es mecánico, no es regla.

## Non-goals

- No implementa un estado intermedio `implemented/integration-pending` (los estados del workflow son los 8 de `README.md`; añadir estados nuevos es tarea separada si se justifica).
- No ejecuta `bun run validate` desde dentro del gate (el gate debe ser barato y síncrono; `validate` sigue siendo el DoD aparte).

## Slices

### S1 — Parse de slices del cuerpo + 5 reglas de coherencia
- **Status**: done
- **Files**:
  - `scripts/gates/lint-proposals.script.ts`
  - `tests/cli/lint-proposals.spec.ts`
- **Gate**: `bun run lint`

### S2 — `INDEX.md` generado, no mantenido a mano
- **Status**: done
- **Files**: `scripts/gates/gen-index.script.ts` + `docs/delendai/proposals/INDEX.md`
- **Gate**: el mismo `lint:proposals` compara INDEX generado vs INDEX commiteado
- **Detalle**: una sola fuente de verdad (el filesystem); el documento se regenera con `bun run lint:proposals:gen-index` y el lint verifica byte a byte con `--check`.

### S3 — Regla de evidencia para gates de alto calibre
- **Status**: done
- **Files**: `scripts/gates/lint-proposals.script.ts` + `docs/delendai/proposals/done/c00004-*.md`
- **Gate**: `bun run lint`
- **Detalle**: una propuesta `done` cuya `acceptance` mencione "validate verde", "E2E" o "CI verde" debe llevar un campo `evidence:` en el frontmatter con un SHA o URL. La verificación del run **no** se hace desde el gate — solo la presencia del campo y que sea accionable.

## acceptance

- [x] Con las cuatro reaperturas actuales (a00014/a00015/a00016/x00025, ya con slices `pending` y `status: ready`), el gate pasa (no introduce falsos positivos).
- [x] Un fixture con `status: done` + una slice `pending` → el gate **falla** (verificado durante el desarrollo: la rama tenía 6 propuestas con ese patrón, las 6 se cerraron en el barrido de cff205b).
- [x] Un fixture con `status: done` + `shippedIn: []` → falla (88 casos en develop antes del barrido). SHA inexistente → falla (verificado con `parseShippedIn` + `isReachableSha`).
- [x] INDEX desincronizado → falla (verificado: 4 propuestas `done` estaban en la nota histórica de Ready y se eliminaron al activar la regla de "solo filas de tabla").
- [x] `bun run validate` verde con las nuevas reglas (los 88 done históricos se cerraron en bloque en cff205b).
- [x] S2: INDEX regenerado desde filesystem + frontmatter; drift falla en `lint:proposals`.
- [x] S3: `evidence:` exigido cuando el `acceptance` exige validate / E2E / CI verde.
