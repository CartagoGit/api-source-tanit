---
id: x00121
title: "Mantener la previsualización y el consentimiento de exportación en el contexto vigente"
kind: fix
status: review
type: proposal
track: app
date: 2026-11-20
last-transition-id: a13c6ef7-4be7-4d77-8c0a-c163584c3e35
last-correlation-id: a13c6ef7-4be7-4d77-8c0a-c163584c3e35
last-transition-from: in-progress
last-transition-at: 2026-11-20T22:16:46.508Z
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
- **Status**: review
- **Files**: `packages/app/src/app/core/state/exports.store.ts`, `packages/app/src/app/features/exports/export-center.component.ts`, `tests/app/live-store.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "La respuesta antigua no cambia la vista, los errores ni el estado de carga de una solicitud posterior."
  - "El destino personalizado, la previsualización, el resultado y el consentimiento quedan limitados al proyecto y sesión que los obtuvieron."
  - "Generar requiere una previsualización vigente. Cambiar de contexto durante una escritura evita publicar un resultado obsoleto o iniciar el siguiente formato. La regeneración de los mismos archivos conserva el consentimiento ya previsto."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `348e54117801`

## acceptance

- La respuesta antigua no cambia la vista, los errores ni el estado de carga de una solicitud posterior.
- El destino personalizado, la previsualización, el resultado y el consentimiento quedan limitados al proyecto y sesión que los obtuvieron.
- Generar requiere una previsualización vigente. Cambiar de contexto durante una escritura evita publicar un resultado obsoleto o iniciar el siguiente formato. La regeneración de los mismos archivos conserva el consentimiento ya previsto.
