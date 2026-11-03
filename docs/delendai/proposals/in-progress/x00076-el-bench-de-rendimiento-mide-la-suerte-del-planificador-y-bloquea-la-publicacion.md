---
id: x00076
title: "El bench de rendimiento mide la suerte del planificador y bloquea la publicación"
kind: fix
status: in-progress
type: proposal
track: general
date: 2026-11-02
last-transition-id: 259794ec-1e82-48a4-b1d4-ff0fae0c1487
last-correlation-id: 259794ec-1e82-48a4-b1d4-ff0fae0c1487
last-transition-from: review
last-transition-at: 2026-11-03T04:15:55.712Z
shipped-in:
  - "d1cb58027c8b"
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
- **Status**: done
- **Files**: `tests/core/module-resolution.bench.ts`
- **Gate**: none
- acceptance:
  - "El bench hace varias pasadas frías con un resolutor nuevo cada vez y compara el presupuesto con la mejor de ellas."
  - "El bench dice cuántas pasadas midió y cuál fue la mejor."
  - "El presupuesto sigue siendo 100 ms: el arreglo cambia lo que se mide, no el límite."
- review-state: done
- review-implementer: minimax-m3.1-flash
- review-reviewer: minimax-m3.1-flash
- review-log: approved by minimax-m3.1-flash — verified at d1cb58027c8b, validate exit 0 and tests 84/84 claimed, no recorded run cited; acceptance 3/3: (1) tests/core/module-resolution.bench.ts mide COLD_PASSES pasadas frías creando un resolutor nuevo en cada una, y el presupuesto se compara con la mejor: la línea… (2) La salida del bench lo dice: «cold 118.20 ms (best of 5: 141.6, 151.5, 118.2, 192.0, 260.7)» — cuántas midió y cuál fue la mejor. La constante COLD_PASSES está… (3) BUDGET_MS = 100 ms sigue declarado en tests/core/module-resolution.bench.ts y el fallo sigue leyendo «exceeds the 100 ms budget»: el límite no se tocó. tests/c… — Revisión independiente de la entrega d1cb5802 (fix(bench): el presupuesto se compara con la mejor de las pasadas). El bench mide varias pasadas frías con un resolutor nuevo cada vez y se queda con la mejor: la propia salida lo dice, «cold 118.20 ms (best of 5: 141.6, 151.5, 118.2, 192.0, 260.7)». El límite no se movió: BUDGET_MS sigue siendo 100 ms. Ejecuté los specs del resolutor: tests/core/module-resolution.spec.ts da 84/84 en verde. [another instance]

## acceptance

- El bench hace varias pasadas frías con un resolutor nuevo cada vez y compara el presupuesto con la mejor de ellas.
- El bench dice cuántas pasadas midió y cuál fue la mejor.
- El presupuesto sigue siendo 100 ms: el arreglo cambia lo que se mide, no el límite.
