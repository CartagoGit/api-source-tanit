---
id: x00119
title: "Dar prioridad a las operaciones en el explorador y compactar la navegación móvil"
kind: fix
status: in-progress
type: proposal
track: beta
date: 2026-11-20
---

# x00119 — Dar prioridad a las operaciones en el explorador y compactar la navegación móvil

## goal

Ver y filtrar operaciones sin desplazar una pantalla entera de controles y mantener la navegación usable en ventanas pequeñas.

## why

Los filtros avanzados y una segunda columna vacía ocupan la vista inicial. Las respuestas fuera de orden pueden sobrescribir el resultado del último filtro.

## non-goals

- Cambiar las reglas de descubrimiento o su esquema de datos.

## slices

- global_gate: lint

### S1 — Explorador compacto, navegación adaptable y filtros coherentes
- **Status**: pending
- **Files**: `packages/app/src/app/features/endpoints/filters.component.ts`, `packages/app/src/app/features/endpoints/filters.component.html`, `packages/app/src/app/features/endpoints/filters.component.scss`, `packages/app/src/app/features/endpoints/endpoints-list.component.ts`, `packages/app/src/app/features/endpoints/endpoints-list.component.html`, `packages/app/src/app/features/endpoints/endpoints-list.component.scss`, `packages/app/src/app/shell/sidebar.component.ts`, `packages/app/src/app/shell/sidebar.component.html`, `packages/app/src/app/shell/sidebar.component.scss`, `packages/app/src/app/core/i18n/locales/es.json`, `packages/app/src/app/core/i18n/locales/en.json`, `packages/app/src/app/core/i18n/locales/fr.json`, `packages/app/src/app/core/state/endpoints.store.ts`, `tests/app/reachable.spec.ts`, `tests/app/endpoints.spec.ts`
- **Gate**: e2e
- acceptance:
  - "La búsqueda y las operaciones quedan visibles sin desplazarse en una ventana pequeña típica. Los filtros avanzados se pueden expandir, combinar y limpiar."
  - "La navegación en móvil ocupa una sola fila cuando está cerrada y permite abrir todas las secciones con teclado y puntero."
  - "Una respuesta atrasada de un filtro o proyecto anterior no cambia el último resultado del backend."

## acceptance

- La búsqueda y las operaciones quedan visibles sin desplazarse en una ventana pequeña típica. Los filtros avanzados se pueden expandir, combinar y limpiar.
- La navegación en móvil ocupa una sola fila cuando está cerrada y permite abrir todas las secciones con teclado y puntero.
- Una respuesta atrasada de un filtro o proyecto anterior no cambia el último resultado del backend.
