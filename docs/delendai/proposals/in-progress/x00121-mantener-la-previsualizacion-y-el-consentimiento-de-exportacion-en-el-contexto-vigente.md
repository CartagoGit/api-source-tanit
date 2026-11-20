---
id: x00121
title: "Mantener la previsualización y el consentimiento de exportación en el contexto vigente"
kind: fix
status: in-progress
type: proposal
track: app
date: 2026-11-20
---

# x00121 — Mantener la previsualización y el consentimiento de exportación en el contexto vigente

## goal

Las exportaciones de Angular muestran y escriben únicamente con la selección de proyecto, sesión, formatos y destino que preparó la previsualización del backend.

## why

Al cambiar destino, formatos o proyecto, solicitudes superpuestas pueden reinstalar una previsualización vieja o marcar listo un destino pendiente. El destino personalizado también pasa de un proyecto al siguiente.

## non-goals

- Cambiar el contrato de Application API, el renderizador o los formatos del CLI.

## slices

- global_gate: lint

### S1 — Aislar el estado y el consentimiento de exportación
- **Status**: pending
- **Files**: `packages/app/src/app/core/state/exports.store.ts`, `tests/app/live-store.spec.ts`
- **Gate**: e2e
- acceptance:
  - "La respuesta antigua no cambia la vista, los errores ni el estado de carga de una solicitud posterior."
  - "El destino personalizado, la previsualización, el resultado y el consentimiento quedan limitados al proyecto y sesión que los obtuvieron."
  - "Generar requiere una previsualización vigente. Cambiar de contexto durante una escritura evita publicar un resultado obsoleto o iniciar el siguiente formato. La regeneración de los mismos archivos conserva el consentimiento ya previsto."

## acceptance

- La respuesta antigua no cambia la vista, los errores ni el estado de carga de una solicitud posterior.
- El destino personalizado, la previsualización, el resultado y el consentimiento quedan limitados al proyecto y sesión que los obtuvieron.
- Generar requiere una previsualización vigente. Cambiar de contexto durante una escritura evita publicar un resultado obsoleto o iniciar el siguiente formato. La regeneración de los mismos archivos conserva el consentimiento ya previsto.
