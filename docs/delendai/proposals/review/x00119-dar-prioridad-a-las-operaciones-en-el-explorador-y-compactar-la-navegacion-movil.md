---
id: x00119
title: "Dar prioridad a las operaciones en el explorador y compactar la navegación móvil"
kind: fix
status: review
type: proposal
track: beta
date: 2026-11-20
last-transition-id: 7c44b051-1790-4688-b328-1c6c53b61abb
last-correlation-id: 7c44b051-1790-4688-b328-1c6c53b61abb
last-transition-from: in-progress
last-transition-at: 2026-11-20T07:59:47.158Z
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
- **Status**: review
- **Files**: `packages/app/src/app/features/endpoints/filters.component.ts`, `packages/app/src/app/features/endpoints/filters.component.html`, `packages/app/src/app/features/endpoints/filters.component.scss`, `packages/app/src/app/features/endpoints/endpoints-list.component.ts`, `packages/app/src/app/features/endpoints/endpoints-list.component.html`, `packages/app/src/app/features/endpoints/endpoints-list.component.scss`, `packages/app/src/app/shell/sidebar.component.ts`, `packages/app/src/app/shell/sidebar.component.html`, `packages/app/src/app/shell/sidebar.component.scss`, `packages/app/src/app/core/i18n/locales/es.json`, `packages/app/src/app/core/i18n/locales/en.json`, `packages/app/src/app/core/i18n/locales/fr.json`, `packages/app/src/app/core/state/endpoints.store.ts`, `tests/app/reachable.spec.ts`, `tests/app/endpoints.spec.ts`, `packages/app/src/app/shell/app-shell.component.scss`
- **Gate**: e2e
- acceptance:
  - "La búsqueda y las operaciones quedan visibles sin desplazarse en una ventana pequeña típica. Los filtros avanzados se pueden expandir, combinar y limpiar."
  - "La navegación en móvil ocupa una sola fila cuando está cerrada y permite abrir todas las secciones con teclado y puntero."
  - "Una respuesta atrasada de un filtro o proyecto anterior no cambia el último resultado del backend."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `47d1900beb29`

## acceptance

- La búsqueda y las operaciones quedan visibles sin desplazarse en una ventana pequeña típica. Los filtros avanzados se pueden expandir, combinar y limpiar.
- La navegación en móvil ocupa una sola fila cuando está cerrada y permite abrir todas las secciones con teclado y puntero.
- Una respuesta atrasada de un filtro o proyecto anterior no cambia el último resultado del backend.
