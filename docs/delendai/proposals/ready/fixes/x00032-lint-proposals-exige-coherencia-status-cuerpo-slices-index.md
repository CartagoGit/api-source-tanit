---
id: x00032
title: "lint:proposals debe verificar cuerpo↔frontmatter↔INDEX: done es imposible con slices pendientes"
kind: fix
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-05
related:
  - a00012
---

# x00032 — El gate de propuestas solo mira el frontmatter: por eso se cierra de más

## Goal

Que `bun run lint:proposals` rechace cualquier propuesta `status: done`
cuyo cuerpo todavía contenga slices `**Status**: pending`, o que no esté
físicamente bajo `done/<kind>/`, o cuyo `shippedIn` sea distinto de vacío,
o que siga listada en la sección Ready de `INDEX.md`.

Hoy el gate solo valida **frontmatter ↔ carpeta**. Con eso en verde, las
revisiones de 2026-09-04/05 encontraron cuatro veces la misma
incoherencia: propuestas `done` en frontmatter con sus slices `pending` en
el cuerpo, y `INDEX.md` desincronizado del filesystem — y la máquina de
estados del agente no las frenó.

## Why

El diagnóstico convergente de las tres revisiones: la disciplina de
cierre es la parte más débil del agente (5,8/10 vs 8,6 de calidad de
código), y el culpable no es solo el agente sino el gate:

- El agente confunde "implementé algo que parece el hallazgo" con "done".
  El gate actual no puede distinguir esas dos frases porque no mira el
  cuerpo.
- La apertura de Slice-status es texto libre en el cuerpo; nadie la
  parsea. Un `**Status**: pending` en una propuesta `done` es una
  contradicción mecanográficamente detectable.
- `INDEX.md` se mantiene a mano y tiene dos fuentes de verdad (frente al
  filesystem y frente a los frontmatter) que ya divergieron en el HEAD de
  las revisiones (listaba `a00014/15/16/b00001` en Ready con las cuatro en
  `done/`).

La regla que convierte "done" en acceptance demostrada se llama gate:
si no es mecánico, no es regla.

## Non-goals

- No implementa un estado intermedio `implemented/integration-pending`
  (los estados del workflow son los 8 de `README.md`; añadir estados
  nuevos es tarea separada si se justifica).
- No ejecuta `bun run validate` desde dentro del gate (el gate debe ser
  barato y síncrono; `validate` sigue siendo el DoD aparte).

## Slices

### S1 — Parse de slices del cuerpo + 5 reglas de coherencia

- **Status**: pending
- **Files**:
  - `scripts/gates/lint-proposals.script.ts`
  - `scripts/gates/tests/lint-proposals.spec.ts` (o el spec del propio gate)
- **Gate**: `bun run lint`
- **Detalle** — nuevas comprobaciones, todas con mensaje que cite id y regla:
  1. `status: done` ⇒ **ningún** `**Status**: pending` (ni `in-progress`,
     `blocked`) bajo la sección `## Slices` del cuerpo.
  2. `status: done` ⇒ `shippedIn:` no vacío y todos los SHAs **alcanzables**
     en `origin/develop` (`git cat-file -e`), no solo presentes (los
     `shippedIn:` actuales de a00014/15/16 fueron añadidos al cerrar — que
     se valide que apuntan a commits reales).
  3. `status: done` ⇒ el fichero vive bajo `done/<kind>/` (ya se hace) **y**
     su `kind` coincide con la subcarpeta (refuerzo).
  4. `status: ready` ⇒ el fichero vive bajo `ready/` (ya se hace) — y al
     invertir: no puede haber una propuesta físicamente en `done/` con
     frontmatter `ready` (es el drift de reapertura que este commit está
     corrigiendo).
  5. `INDEX.md`: ninguna propuesta con `status: done` puede aparecer en la
     tabla "Ready", y toda propuesta `ready`/`blocked` debe aparecer en su
     tabla. Generación automática de INDEX (ver S2) o verificación de la
     tabla contra el escaneo del filesystem/`ls`.

### S2 — `INDEX.md` generado, no mantenido a mano

- **Status**: pending
- **Files**: `scripts/gates/gen-index.script.ts` (nuevo, o modo del lint) + `docs/delendai/proposals/INDEX.md`
- **Gate**: el mismo `lint:proposals` compara INDEX generado vs INDEX commiteado
- **Detalle**: una sola fuente de verdad (el filesystem); el documento se
  regenera con `bun run lint:proposals:fix` o es verificado byte a byte.

### S3 — Regla de evidencia para gates de alto calibre

- **Status**: pending
- **Files**: gate + `docs/delendai/proposals/done/…`
- **Gate**: `bun run lint`
- **Detalle**: una propuesta `done` cuya `acceptance` mencione "validate
  verde" o "E2E" debe llevar un campo `evidence:` en el frontmatter con un
  run de Actions (`gh run` id o URL). La verificación del run **no** se hace
  desde el gate — solo la presencia del campo. El resto lo exige el
  revisor humano/agente. Éste es el candado contra la frase "regresión cero"
  escrita mientras el workflow ni llegó a `bun install`.

## acceptance

1. Con las cuatro reaperturas actuales (a00014/a00015/a00016/x00025, ya con
   slices `pending` y `status: ready`), el gate pasa (no introduce falsos
   positivos).
2. Un fixture con `status: done` + una slice `pending` → el gate **falla**.
3. Un fixture con `status: done` + `shippedIn: []` → falla. SHA inexistente →
   falla.
4. INDEX desincronizado → falla.
5. `bun run validate` verde con las nuevas reglas (los ~97 `done` actuales
   pasan sin ediciones masivas, o las ediciones que hagan falta se cuentan
   en S1 y se documentan).
6. CI de i00002 verde como pre-condición de este gate (x00032 no puede
   demostrarse mientras Actions no llegue a `validate`).
