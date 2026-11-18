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
shipped-in:
  - "9f10a99e38a8ea5975db6fe2dcb0a74f8a8dfc5c"
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
- **Status**: done
- **Files**: `packages/contracts/constants/core/contract-evidence.constant.ts`, `packages/contracts/interfaces/core/contract-evidence.interface.ts`, `packages/contracts/interfaces/core/scanner.interface.ts`, `packages/contracts/interfaces/core/discovery.interface.ts`, `packages/contracts/interfaces/core/domain.interface.ts`, `packages/contracts/constants/core/application-api.constant.ts`, `packages/core/adapters/parsed-route-to-spec.adapter.ts`, `packages/core/discovery/contract-reconciliation.service.ts`, `packages/core/discovery/generation.pipeline.ts`, `packages/core/discovery/generation-summary.helper.ts`, `packages/core/application-api/snapshot-summary.helper.ts`, `packages/frameworks/scanners/openapi.scanner.ts`, `tests/core/contract-reconciliation.spec.ts`, `tests/frameworks/openapi-hybrid.spec.ts`
- **Gate**: targeted reconciliation, hybrid pipeline and API summary tests
- acceptance:
  - "Un servicio agnóstico compara candidatos originales sin modificar el resultado del merger; conserva origen, archivo, identidad de servicio y diferencias observadas."
  - "Los límites del parser o del scanner hacen desconocida la ausencia; ningún scanner histórico se presume completo."
  - "Generación, resumen común y snapshots de Application API proyectan el mismo informe, validado por un contrato único."
- shipped-in: `743d25852042`
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at 9f10a99e38a8, validate exit 0 and tests 100/100 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed landed contract-reconciliation.service.ts and generation.pipeline.ts: reconciliation reads per-scanner candidate specs/routes, groups by service and n… (2) Reviewed adapter defaults for undeclared scanner coverage to unknown and propagates diagnostics/validation failures as partial. OpenAPI declares partial comple… (3) Focused hybrid test verifies the generated report passes ContractEvidenceReportSchema through SnapshotSummarySchema and that generation summary and Application… — Approved S1 independently on landed develop 9f10a99e. Scope is static route identity and overlapping validation type/required/format/auth assertions; report limitations explicitly exclude body/schema graphs, responses, and live HTTP. S2/S3 remain open; this approval does not close the overall proposal.

### S2 — Descubrimiento y referencias locales de documentación
- **Status**: review
- **Files**: `packages/frameworks/scanners/openapi.scanner.ts`, `packages/contracts/constants/core/contract-evidence.constant.ts`, `packages/contracts/interfaces/core/contract-evidence.interface.ts`, `packages/contracts/interfaces/core/scanner.interface.ts`, `packages/contracts/interfaces/runtime.d.ts`, `packages/core/discovery/contract-reconciliation.service.ts`, `tests/frameworks/openapi-scanner.spec.ts`, `tests/frameworks/openapi-hybrid.spec.ts`, `tests/core/contract-reconciliation.spec.ts`
- **Gate**: targeted OpenAPI discovery and bounded local reference tests
- acceptance:
  - "Reutilizar el parser para múltiples especificaciones JSON/YAML y referencias locales contenidas, con ciclos y límites explícitos; sin ejecutar código ni red automática."
  - "Detectar configuración Swagger estáticamente resoluble y enlaces declarados literales HTTP(S), sin credenciales ni URLs inventadas; conservar límites de resolución y completar descripciones compatibles con procedencia."
  - "Transportar el archivo relativo, pointer RFC 6901 y referencias locales resueltas por el contrato común y la proyección de reconciliación, sin perder procedencia."
- shipped-in: `dc881f5c12261588e6abc4e78bf4e07a39c484cf`
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol

### S3 — Presentación del informe común
- **Status**: review
- **Files**: `packages/cli/commands/summary.script.ts`, `packages/ui/web/index.html.constant.ts`, `packages/app/src/app/features/diagnostics`, `packages/app/src/app/core/i18n/locales`, `tests/app/diagnostics.spec.ts`, `tests/app/reachable.spec.ts`, `tests/cli/contract-evidence-summary.spec.ts`
- **Gate**: real carrier rendering, localized diagnostics and CLI report tests
- acceptance:
  - "CLI, web y escritorio representan origen, punteros, comparaciones y conflictos del mismo informe, con JSON completo y vistas acotadas; el flujo de exportación se conserva."
  - "La presentación consume el snapshot compartido y renderiza texto sin hacer solicitudes de red de documentación."
- shipped-in: `b0747b9bc82341dd21a83741f83c8659b79a3411`
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol

### S4 — Lectura explícita de documentación original
- **Status**: pending
- **DependsOn**: [S2, S3]
- **Files**: `packages/core/application-api`, `packages/contracts/constants/core/application-api.constant.ts`, `packages/contracts/interfaces/core/application-api.interface.ts`, `packages/app/src/app/features/diagnostics`, `tests/app/diagnostics.spec.ts`
- **Gate**: artifact containment, viewer rendering and explicit remote access tests
- acceptance:
  - "El usuario puede abrir como texto un artefacto listado en el informe activo del servicio, con ruta contenida y lectura acotada."
  - "La lectura remota requiere URL o acción explícita y comprueba límites de tiempo, tamaño y redirecciones. El escaneo y el render no abren URLs ni referencias remotas."

### S5 — Paridad de la integración MCP opcional
- **Status**: pending
- **Files**: `integrations/delendai/src/lib/contracts/plugin.interface.ts`, `integrations/delendai/src/lib/tools/summary.tool.ts`, `integrations/delendai/src/index.ts`, `integrations/delendai/package.json`, `integrations/delendai/bun.lock`, `integrations/delendai/tests/integration/summary.tool.spec.ts`, `integrations/delendai/src/lib/tools/test.tool.ts`, `integrations/delendai/src/lib/helpers/runner.helper.ts`, `integrations/delendai/src/lib/helpers/smoke-runner.helper.ts`, `integrations/delendai/tests/integration/test.tool.spec.ts`
- **Gate**: pinned optional integration tests and schema validation
- acceptance:
  - "La herramienta summary opcional expone el mismo informe compartido reutilizando su schema, sin reconstruir hechos ni introducir dependencias DelendAI en el producto."
  - "Versionar la superficie pública del plugin y comprobar su salida contra el runtime inmutable 0.3.0."
  - "La validación del plugin conserva las duraciones válidas aunque cambie el reloj del sistema."
  - "La instalación independiente del plugin valida su lock con la misma remediación de picomatch que emplea Tanit y pasa la auditoría de severidad alta."

## acceptance

- Reutilizar el scanner/parser para localizar especificaciones JSON/YAML y referencias locales contenidas; sin ejecutar el proyecto ni acceder a red por defecto.
- Conservar origen y límites de resolución; detectar configuración Swagger estáticamente resoluble y enlaces declarados literales HTTP(S), sin credenciales ni URLs inventadas.
- Las observaciones documentales llevan archivo relativo y pointer RFC 6901; las referencias locales resueltas conservan su archivo y pointer de origen en el contrato común y en la proyección de reconciliación.
- Distinguir coincidencias, solo documentado, solo observado y conflictos; desconocido del scanner no demuestra ausencia.
- Completar descripciones compatibles con procedencia; sin sobreescribir conflictos ni convertir Swagger en verdad absoluta.
- Un servicio común entrega idéntico informe semántico a CLI, web y escritorio; consumidores representan documentación original, comparación y exportación.
- Red únicamente por URL/autorización explícita con límites de tiempo, tamaño, redirecciones y referencias.
