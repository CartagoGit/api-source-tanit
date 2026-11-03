---
id: x00076
title: "El bench de rendimiento mide la suerte del planificador y bloquea la publicación"
kind: fix
status: in-progress
type: proposal
track: general
date: 2026-11-02
last-transition-id: dd808f6a-45b3-41e9-8ed2-8d1239d42470
last-correlation-id: dd808f6a-45b3-41e9-8ed2-8d1239d42470
last-transition-from: ready
last-transition-at: 2026-11-03T02:39:02.512Z
---

# x00076 — El bench de rendimiento mide la suerte del planificador y bloquea la publicación

## goal

Que el gate de rendimiento mida la velocidad del resolutor y no el ruido de la máquina, para que publicar no dependa de cuánta carga tenga el equipo en ese momento.

## why

El bench de resolución de módulos mide **una sola** pasada fría y la compara con un presupuesto absoluto de 100 ms. Una pasada fría es una medición de la suerte del planificador: si el equipo está ocupado, la pasada tarda 110 ms o 200 ms y el gate falla, aunque el resolutor no haya cambiado ni un milisegundo. Lo que pasó: en una máquina con otra carga de trabajo, la prueba de `delendai work publish` —que exige que la validación pase— falló dos veces seguidas por el bench (111 ms y 211 ms), sin que ninguna de las dos veces hubiera un cambio de código detrás. Con la máquina quieta, la misma pasada da 44-48 ms. Un gate de rendimiento que depende de cuánta carga tiene el equipo en ese momento no mide el código: mide la agenda, y cuando falla no dice nada de lo que hay que arreglar.

## non-goals

- No se sube el presupuesto de 100 ms: el límite no se toca.
- No se cambia el resolver: aquí no hay ningún defecto de rendimiento que arreglar.

## slices

- global_gate: none

### S1-el-presupuesto-se-compara-con-la-mejor-pasada — S1 — El presupuesto se compara con la mejor de las pasadas
- **Status**: pending
- **Files**: `tests/core/module-resolution.bench.ts`
- **Gate**: none
- acceptance:
  - "El bench hace varias pasadas frías con un resolutor nuevo cada vez y compara el presupuesto con la mejor de ellas."
  - "El bench dice cuántas pasadas midió y cuál fue la mejor."
  - "El presupuesto sigue siendo 100 ms: el arreglo cambia lo que se mide, no el límite."

## acceptance

- El bench hace varias pasadas frías con un resolutor nuevo cada vez y compara el presupuesto con la mejor de ellas.
- El bench dice cuántas pasadas midió y cuál fue la mejor.
- El presupuesto sigue siendo 100 ms: el arreglo cambia lo que se mide, no el límite.
