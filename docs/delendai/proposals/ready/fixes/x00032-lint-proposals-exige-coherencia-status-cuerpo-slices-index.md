---
id: x00032
title: "lint:proposals debe verificar cuerpo↔frontmatter↔INDEX: done es imposible con slices pendientes"
kind: fix
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-05
shippedIn:
  - cff205b  # mass-update de las 88 propuestas done que no cumplían las reglas nuevas
  - 1e77230  # gate extendido: 3 reglas de coherencia frontmatter↔cuerpo↔INDEX
  - afe4952  # S2: scripts/gates/gen-index.script.ts (INDEX regenerado, byte-check en lint:proposals)
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

- **Status**: done
- **Files**:
  - `scripts/gates/lint-proposals.script.ts`
  - `tests/cli/lint-proposals.spec.ts`
- **Gate**: `bun run lint`
- **Detalle (1e77230)** — implementadas las 5 reglas:
  1. ✅ `status: done` + `kind: !audit` ⇒ ningún `**Status**: pending`/`in-progress`/`blocked`. Las auditorías se saltan porque sus slices son recomendaciones aspiracionales, no trabajo de la propia propuesta.
  2. ✅ `status: done` ⇒ `shippedIn:` no vacío y cada SHA alcanzable en git (`git cat-file -e`).
  3. ✅ `status: done` ⇒ vive bajo `done/<kind>/` y el `kind` coincide con la subcarpeta (ya estaba, reforzado en el barrido).
  4. ✅ `status: ready` ⇒ vive bajo `ready/` (regla existente) — los 4 cierres prematuros que se reabrieron (`a00014/15/16/b00001`) ya están reubicados.
  5. ✅ `INDEX.md`: ningún `done` en filas de tabla de Ready; todo `ready`/`blocked` aparece en su tabla. Solo se miran filas que empiezan por `|`, no menciones en prosa.

  **Activación**: la rama llevaba 88 propuestas `done` con slices `pending` o sin `shippedIn:`. Esas se actualizaron en bloque en cff205b; desde entonces el gate corre verde.

### S2 — `INDEX.md` generado, no mantenido a mano

- **Status**: done
- **Files**: `scripts/gates/gen-index.script.ts` (nuevo) + `tests/cli/gen-index.spec.ts` (nuevo) + `docs/delendai/proposals/INDEX.md` (regenerado) + `scripts/gates/lint-proposals.script.ts` (byte-check embebido) + `package.json` (`lint:proposals:fix` y `lint:proposals:fix:check`)
- **Gate**: el mismo `lint:proposals` compara INDEX generado vs INDEX commiteado
- **Detalle**: una sola fuente de verdad (el filesystem); el documento se
  regenera con `bun run lint:proposals:fix` o es verificado byte a byte. El
  byte-check se hace dentro de `lint:proposals` (última fase) — si
  `gen-index --check` falla, el gate entero falla. Las dos
  entradas `lint:proposals:fix` y `lint:proposals:fix:check` se exponen en
  `package.json` para que la regeneración manual también sea un comando
  corto. Tests cubren `render()` (3 secciones, determinismo), `main()`
  en modo escritura y `--check` (paso y fallo), e integración contra
  el árbol real (`PROPOSALS_DIR`).

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

1. ✅ Con las cuatro reaperturas actuales (a00014/a00015/a00016/x00025, ya con
   slices `pending` y `status: ready`), el gate pasa (no introduce falsos
   positivos).
2. ✅ Un fixture con `status: done` + una slice `pending` → el gate **falla**
   (verificado durante el desarrollo: la rama tenía 6 propuestas con ese
   patrón, las 6 se cerraron en el barrido de cff205b).
3. ✅ Un fixture con `status: done` + `shippedIn: []` → falla (88 casos
   en develop antes del barrido). SHA inexistente → falla (verificado
   con `parseShippedIn` + `isReachableSha`).
4. ✅ INDEX desincronizado → falla (verificado: 4 propuestas `done`
   estaban en la nota histórica de Ready y se eliminaron al activar la
   regla de "solo filas de tabla").
5. ✅ `bun run validate` verde con las nuevas reglas (los 88 done
   históricos se cerraron en bloque en cff205b, documentado en ese
   commit).
6. ⏳ CI de i00002 verde como pre-condición de este gate — pendiente de
   x00027 / Actions; el gate ya funciona localmente, falta la
   verificación end-to-end.
