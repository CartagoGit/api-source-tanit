---
id: f00020
title: "Descubrir Swagger existente y reconciliar contratos con evidencia del código"
kind: feat
status: ready
type: proposal
track: contracts
date: 2026-11-10
---

# f00020 — Descubrir Swagger existente y reconciliar contratos con evidencia del código

## goal

Usar OpenAPI/Swagger como fuente nativa adicional sin sustituir silenciosamente los hechos del análisis.

## why

Reutilizar scanner/importador existente con enlaces e informe común de discrepancias; no afirmar que la mera importación ya cumple esta capacidad.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — Descubrimiento y reconciliación comunes
- **Status**: pending
- **Files**: `packages/core/services/contract-reconciliation.service.ts`, `packages/contracts/interfaces/core/contract-evidence.interface.ts`, `packages/frameworks/scanners/openapi.scanner.ts`, `packages/core/application-api`, `packages/cli`, `packages/ui`, `tests/contracts`
- **Gate**: e2e
- acceptance:
  - "Reutilizar el scanner/parser para localizar especificaciones JSON/YAML y referencias locales contenidas; sin ejecutar el proyecto ni acceder a red por defecto."
  - "Conservar origen y límites de resolución; detectar configuración Swagger estáticamente resoluble y enlaces sin inventar URLs."
  - "Distinguir coincidencias, solo documentado, solo observado y conflictos; desconocido del scanner no demuestra ausencia."
  - "Completar descripciones compatibles con procedencia; sin sobreescribir conflictos ni convertir Swagger en verdad absoluta."
  - "Un servicio común entrega idéntico informe semántico a CLI, web y escritorio; consumidores representan documentación original, comparación y exportación."
  - "Red únicamente por URL/autorización explícita con límites de tiempo, tamaño, redirecciones y referencias."

## acceptance

- Reutilizar el scanner/parser para localizar especificaciones JSON/YAML y referencias locales contenidas; sin ejecutar el proyecto ni acceder a red por defecto.
- Conservar origen y límites de resolución; detectar configuración Swagger estáticamente resoluble y enlaces sin inventar URLs.
- Distinguir coincidencias, solo documentado, solo observado y conflictos; desconocido del scanner no demuestra ausencia.
- Completar descripciones compatibles con procedencia; sin sobreescribir conflictos ni convertir Swagger en verdad absoluta.
- Un servicio común entrega idéntico informe semántico a CLI, web y escritorio; consumidores representan documentación original, comparación y exportación.
- Red únicamente por URL/autorización explícita con límites de tiempo, tamaño, redirecciones y referencias.
