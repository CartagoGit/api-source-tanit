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
  - "cad6fe6d1cb66b11301a2dc50860ce443deb8323"
  - "5042bdd249e49a74249255fbd4e67da8aac35e7d"
  - "9116cc33b348f3ff5f6b93691b2236c232a651da"
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
- **Status**: done
- **Files**: `packages/frameworks/scanners/openapi.scanner.ts`, `packages/contracts/constants/core/contract-evidence.constant.ts`, `packages/contracts/interfaces/core/contract-evidence.interface.ts`, `packages/contracts/interfaces/core/scanner.interface.ts`, `packages/contracts/interfaces/runtime.d.ts`, `packages/core/discovery/contract-reconciliation.service.ts`, `tests/frameworks/openapi-scanner.spec.ts`, `tests/frameworks/openapi-hybrid.spec.ts`, `tests/core/contract-reconciliation.spec.ts`
- **Gate**: targeted OpenAPI discovery and bounded local reference tests
- acceptance:
  - "Reutilizar el parser para múltiples especificaciones JSON/YAML y referencias locales contenidas, con ciclos y límites explícitos; sin ejecutar código ni red automática."
  - "Detectar configuración Swagger estáticamente resoluble y enlaces declarados literales HTTP(S), sin credenciales ni URLs inventadas; conservar límites de resolución y completar descripciones compatibles con procedencia."
  - "Transportar el archivo relativo, pointer RFC 6901 y referencias locales resueltas por el contrato común y la proyección de reconciliación, sin perder procedencia."
- shipped-in: `dc881f5c12261588e6abc4e78bf4e07a39c484cf`
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6
- review-log: approved by openai-gpt-6 — verified at cad6fe6d1cb6, validate exit 0 and tests 75/75 claimed, no recorded run cited; acceptance 3/3: (1) Bounded existing parser handles multiple JSON/YAML docs and contained refs; cycle/depth/document/size/time limits explicit. Focused tests pass. (2) Static AST literal config only, credential-free HTTP(S) schema, dynamic configuration limitations; descriptions remain attributed evidence. (3) Operation-scoped sourceFile/sourcePointer/sourceReferences retained in contract and reconciliation projection; focused provenance tests pass. — Independent landed review cad6fe6d, matches fa6bfc1f except compatible runtime declarations. Directly ran bunx vitest run --project frameworks --project core tests/frameworks/openapi-scanner.spec.ts tests/frameworks/openapi-hybrid.spec.ts tests/core/contract-reconciliation.spec.ts: 75/75, 3 files, exit 0, 2026-11-18 18:56:34 local. Counts reviewer-reported, no journal run cited. Published #163 CI 44363182400 independently verified success. S2 only; S4 pending.

### S3 — Presentación del informe común
- **Status**: done
- **Files**: `packages/cli/commands/summary.script.ts`, `packages/ui/web/index.html.constant.ts`, `packages/app/src/app/features/diagnostics`, `packages/app/src/app/core/i18n/locales`, `tests/app/diagnostics.spec.ts`, `tests/app/reachable.spec.ts`, `tests/cli/contract-evidence-summary.spec.ts`
- **Gate**: real carrier rendering, localized diagnostics and CLI report tests
- acceptance:
  - "CLI, web y escritorio representan origen, punteros, comparaciones y conflictos del mismo informe, con JSON completo y vistas acotadas; el flujo de exportación se conserva."
  - "La presentación consume el snapshot compartido y renderiza texto sin hacer solicitudes de red de documentación."
- shipped-in: `b0747b9bc82341dd21a83741f83c8659b79a3411`
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6
- review-log: approved by openai-gpt-6 — verified at cad6fe6d1cb6, validate exit 0 and tests 14/14 claimed, no recorded run cited; acceptance 2/2: (1) CLI, embedded web and Angular diagnostics consume shared evidence; origins/pointers/conflicts displayed with bounded operation views and full CLI JSON. Existin… (2) Angular reads ProjectStore shared snapshot; embedded web renders existing inspection response; textContent/interpolation render evidence without interpreting m… — Independent landed review cad6fe6d; carrier sources identical to b641fe9b. Directly ran bunx vitest run --project cli --project app tests/cli/contract-evidence-summary.spec.ts tests/app/diagnostics.spec.ts tests/app/reachable.spec.ts: 14/14, 3 files, exit 0, 2026-11-18 18:56:58 local. Counts reviewer-reported, no journal run cited. #165 published full CI checks/run 44266873071 successful. S3 only; no overall closure; S4 pending and S5 separately reviewed.

### S4 — Visor de documentación local
- **Status**: done
- **DependsOn**: [S2, S3]
- **Files**: `packages/core/application-api`, `packages/contracts/constants/core/application-api.constant.ts`, `packages/contracts/interfaces/core/application-api.interface.ts`, `packages/contracts/interfaces/ui/host-bridge.interface.ts`, `packages/core/helpers/read-bounded-text.helper.ts`, `packages/frameworks/scanners/openapi.scanner.ts`, `packages/app/src/app/features/diagnostics`, `packages/app/src/app/core/i18n/locales`, `tests/app/diagnostics.spec.ts`, `tests/application-api/handlers.spec.ts`, `docs/API.md`
- **Gate**: artifact containment, bounded UTF-8 and viewer rendering tests
- acceptance:
  - "El usuario puede abrir como texto un artefacto listado en el informe activo del servicio, con ruta contenida y lectura acotada."
  - "La vista ignora respuestas de sesiones anteriores, no interpreta contenido como HTML y no abre enlaces ni referencias remotas."
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6.1-sol
- review-log: approved by openai-gpt-6.1-sol — verified at 5042bdd249e4, validate exit 0 and tests 115/115 claimed, no recorded run cited; acceptance 2/2: (1) Handler valida sessionId, servicio y artefacto del informe activo; ensureInside resuelve symlinks; lector exige archivo regular, O_NOFOLLOW, limite 256KiB y UT… (2) Handler revalida snapshot tras await; UI compara identidad de peticion y snapshot e interpola texto en pre. Tests diagnostics verifican HTML literal y descarte… — Revision independiente de codigo aterrizado 6f05b02a; 2026-11-20 01:02 local: vitest core/app/frameworks handlers.spec.ts diagnostics.spec.ts openapi-scanner.spec.ts 105/105; path-containment.helper.spec.ts 10/10, exit0. Recuentos ejecutados directamente, sin journal. S4 solamente; S6 pendiente y propuesta global abierta.

### S5 — Paridad de la integración MCP opcional
- **Status**: done
- **Files**: `integrations/delendai/src/lib/contracts/plugin.interface.ts`, `integrations/delendai/src/lib/tools/summary.tool.ts`, `integrations/delendai/src/index.ts`, `integrations/delendai/package.json`, `integrations/delendai/bun.lock`, `integrations/delendai/tests/integration/summary.tool.spec.ts`, `integrations/delendai/src/lib/tools/test.tool.ts`, `integrations/delendai/src/lib/helpers/runner.helper.ts`, `integrations/delendai/src/lib/helpers/smoke-runner.helper.ts`, `integrations/delendai/tests/integration/test.tool.spec.ts`
- **Gate**: pinned optional integration tests and schema validation
- acceptance:
  - "La herramienta summary opcional expone el mismo informe compartido reutilizando su schema, sin reconstruir hechos ni introducir dependencias DelendAI en el producto."
  - "Versionar la superficie pública del plugin y comprobar su salida contra el runtime inmutable 0.3.0."
  - "La validación del plugin conserva las duraciones válidas aunque cambie el reloj del sistema."
  - "La instalación independiente del plugin valida su lock con la misma remediación de picomatch que emplea Tanit y pasa la auditoría de severidad alta."
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6.1-sol
- review-log: approved by openai-gpt-6.1-sol — verified at 9116cc33b348, validate exit 0 and tests 152/152 claimed, no recorded run cited; acceptance 4/4: (1) SummaryOutputSchema importa ContractEvidenceReportSchema; summary proyecta summarizeWithAllFrameworks y test compara informe completo y pointers con resumen co… (2) Plugin version0.2.0 y peer0.3.0; runtime --verify confirma f8ab95e8caf66128f8cd18cbf5b3035f74172ba4; salida parseada con schema; typecheck fuente/tests y suite… (3) test.tool y runners usan performance.now; prueba reports valid elapsed durations when the wall clock moves backward valida TestOutputSchema y duraciones no neg… (4) Manifest y bun.lock independientes fijan npm:@ryotsu/picomatch@4.0.7 con integridad; workflow instala frozen-lockfile. bun audit --audit-level high ejecutado e… — Revision independiente de codigo aterrizado 6f05b02a. Desde integrations/delendai: ../../node_modules/.bin/vitest run --config vitest.config.ts:152/152,14 archivos,exit0; tsc --noEmit tsconfig.json y tsconfig.test.json exit0; bun audit --audit-level high exit0/0 vulnerabilidades95 paquetes. Runtime --verify correcto pin0.3.0. Recuentos ejecutados directamente sin journal. S5 solamente; S6 pendiente y propuesta global abierta.

### S6 — Lectura remota autorizada
- **Status**: pending
- **DependsOn**: [S4]
- **Files**: `packages/core/application-api`, `packages/contracts/constants/core/application-api.constant.ts`, `packages/contracts/interfaces/core/application-api.interface.ts`, `packages/contracts/interfaces/ui/host-bridge.interface.ts`, `packages/app/src/app/features/diagnostics`, `packages/app/src/app/core/i18n/locales`, `tests/application-api/handlers.spec.ts`, `tests/app/diagnostics.spec.ts`
- **Gate**: explicit remote authorization and bounded network tests
- acceptance:
  - "La lectura remota requiere URL o acción explícita y comprueba límites de tiempo, tamaño y redirecciones. El escaneo y el render no abren URLs ni referencias remotas."
  - "Validar el destino de cada conexión autorizada y conservar el informe estático si la lectura se rechaza o falla."


## acceptance

- Reutilizar el scanner/parser para localizar especificaciones JSON/YAML y referencias locales contenidas; sin ejecutar el proyecto ni acceder a red por defecto.
- Conservar origen y límites de resolución; detectar configuración Swagger estáticamente resoluble y enlaces declarados literales HTTP(S), sin credenciales ni URLs inventadas.
- Las observaciones documentales llevan archivo relativo y pointer RFC 6901; las referencias locales resueltas conservan su archivo y pointer de origen en el contrato común y en la proyección de reconciliación.
- Distinguir coincidencias, solo documentado, solo observado y conflictos; desconocido del scanner no demuestra ausencia.
- Completar descripciones compatibles con procedencia; sin sobreescribir conflictos ni convertir Swagger en verdad absoluta.
- Un servicio común entrega idéntico informe semántico a CLI, web y escritorio; consumidores representan documentación original, comparación y exportación.
- Red únicamente por URL/autorización explícita con límites de tiempo, tamaño, redirecciones y referencias.
