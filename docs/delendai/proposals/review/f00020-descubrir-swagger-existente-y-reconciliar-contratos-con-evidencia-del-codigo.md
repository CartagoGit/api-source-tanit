---
id: f00020
title: "Descubrir Swagger existente y reconciliar contratos con evidencia del código"
kind: feat
status: review
type: proposal
track: contracts
date: 2026-11-10
last-transition-id: 91dcd64d-b9f4-4d0e-85d5-0d3beaa59a6d
last-correlation-id: 91dcd64d-b9f4-4d0e-85d5-0d3beaa59a6d
last-transition-from: in-progress
last-transition-at: 2026-11-11T00:31:53.885Z
---

# f00020 — Descubrir Swagger existente y reconciliar contratos con evidencia del código

## goal

Usar OpenAPI/Swagger como fuente nativa adicional sin sustituir silenciosamente los hechos del análisis.

## why

Reutilizar scanner/importador existente con enlaces e informe común de discrepancias; no afirmar que la mera importación ya cumple esta capacidad.

## non-goals

- Ejecutar código del proyecto analizado o realizar peticiones de red automáticas.
- Presentar inferencia incompleta como ausencia demostrada o resolver conflictos sin conservar ambos orígenes.
- Crear otro parser OpenAPI o recalcular el informe en los clientes.

## slices

- global_gate: none

### S1 — Informe común y procedencia del escaneo
- **Status**: review
- **Files**: `packages/contracts/constants/core/contract-evidence.constant.ts`, `packages/contracts/interfaces/core/contract-evidence.interface.ts`, `packages/contracts/interfaces/core/scanner.interface.ts`, `packages/contracts/interfaces/core/discovery.interface.ts`, `packages/contracts/interfaces/core/domain.interface.ts`, `packages/contracts/constants/core/application-api.constant.ts`, `packages/core/adapters/parsed-route-to-spec.adapter.ts`, `packages/core/discovery/contract-reconciliation.service.ts`, `packages/core/discovery/generation.pipeline.ts`, `packages/core/discovery/generation-summary.helper.ts`, `packages/core/application-api/snapshot-summary.helper.ts`, `packages/frameworks/scanners/openapi.scanner.ts`, `tests/core/contract-reconciliation.spec.ts`, `tests/frameworks/openapi-hybrid.spec.ts`
- **Gate**: targeted reconciliation, hybrid pipeline and API summary tests
- acceptance:
  - "Un servicio agnóstico compara candidatos originales sin modificar el resultado del merger; conserva origen, archivo, identidad de servicio y diferencias observadas."
  - "Los límites del parser o del scanner hacen desconocida la ausencia; ningún scanner histórico se presume completo."
  - "Generación, resumen común y snapshots de Application API proyectan el mismo informe, validado por un contrato único."
- shipped-in: `743d25852042`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

### S2 — Descubrimiento y referencias locales de documentación
- **Status**: review
- **Files**: `packages/frameworks/scanners/openapi.scanner.ts`, `packages/contracts/interfaces/core/contract-evidence.interface.ts`, `tests/frameworks/openapi-scanner.spec.ts`
- **Gate**: targeted OpenAPI discovery and bounded local reference tests
- acceptance:
  - "Reutilizar el parser para múltiples especificaciones JSON/YAML y referencias locales contenidas, con ciclos y límites explícitos; sin ejecutar código ni red automática."
  - "Detectar configuración Swagger estáticamente resoluble y enlaces sin inventar URLs; conservar límites de resolución y completar descripciones compatibles con procedencia."
- shipped-in: `bc02a49eb276`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

### S3 — Presentación común y controles de acceso remoto
- **Status**: review
- **Files**: `packages/cli`, `packages/ui`, `packages/app`, `packages/core/application-api`, `tests/contracts`
- **Gate**: carrier rendering and explicit remote authorization tests
- acceptance:
  - "CLI, web y escritorio representan documentación original, comparación y exportación a partir del mismo informe; conservan conflictos visibles."
  - "Red únicamente por URL/autorización explícita con límites de tiempo, tamaño, redirecciones y referencias."
- shipped-in: `bc02a49eb276`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

## acceptance

- Reutilizar el scanner/parser para localizar especificaciones JSON/YAML y referencias locales contenidas; sin ejecutar el proyecto ni acceder a red por defecto.
- Conservar origen y límites de resolución; detectar configuración Swagger estáticamente resoluble y enlaces sin inventar URLs.
- Distinguir coincidencias, solo documentado, solo observado y conflictos; desconocido del scanner no demuestra ausencia.
- Completar descripciones compatibles con procedencia; sin sobreescribir conflictos ni convertir Swagger en verdad absoluta.
- Un servicio común entrega idéntico informe semántico a CLI, web y escritorio; consumidores representan documentación original, comparación y exportación.
- Red únicamente por URL/autorización explícita con límites de tiempo, tamaño, redirecciones y referencias.
