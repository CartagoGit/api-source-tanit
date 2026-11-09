---
id: x00091
title: "Eliminar deriva de runtime y protecciones en workflows auxiliares"
kind: fix
status: review
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: 02d0207f-5ed9-4be4-9087-3b86bbdcf49b
last-correlation-id: 02d0207f-5ed9-4be4-9087-3b86bbdcf49b
last-transition-from: in-progress
last-transition-at: 2026-11-09T14:24:35.521Z
shipped-in:
  - "bebadb7005b46141961d4924c96e8a97268ad2d5"
  - "fa48eeec5015a9c4853d4812f5e39d4948a3fb05"
---

# x00091 — Eliminar deriva de runtime y protecciones en workflows auxiliares

## goal

La integración opcional de CI debe ejecutar el mismo commit DelendAI 0.3.0 que el proyecto y las protecciones deben aplicar exactamente la política común, preservando los valores false explícitos.

## why

El workflow opcional comprobaba una versión móvil del runtime y aplicaba
efectos administrativos que no pertenecían a esa validación. El paquete del
plugin tampoco tenía una instalación reproducible del core fijado, y sus
tools deben seguir siendo compatibles con ese runtime concreto.

## non-goals

- Cambiar la política de ramas, publicar `@delendai/core` o actualizar el pin.

## slices

- global_gate: none

### S1 — Runtime inmutable y protecciones derivadas de la política
- **Status**: done
- **Files**: `.github/workflows/integration-delendai.yml`, `.github/workflows/protect-develop.yml`, `scripts/gates/branch-protection-payload.script.ts`, `tests/scripts-gates/integration-delendai-workflow.spec.ts`, `tests/scripts-gates/branch-protection.spec.ts`, `integrations/delendai/bun.lock`, `integrations/delendai`, `integrations/delendai/tests/integration/check.tool.spec.ts`, `integrations/delendai/vitest.config.ts`
- **Gate**: e2e
- acceptance:
  - "CI lee el pin JSON y verifica su commit, sin checkout develop ni sibling obligatorio."
  - "La integración no modifica reglas de rama."
  - "El aplicador de protecciones usa las mismas funciones que el verificador y conserva false."
  - "La validación local del plugin usa el core fijado."
  - "The pinned plugin test suite passes after a frozen install."
- shipped-in: `7d62d54b`
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at fa48eeec5015, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 5/5: (1) Reviewed integrations/delendai-runtime.json and .github/workflows/integration-delendai.yml plus the workflow regression test; the job verifies the immutable pi… (2) Reviewed the optional integration workflow and branch protection workflow tests; the integration job does not write branch protection settings. (3) Reviewed branch-protection-payload.script.ts and tests/scripts-gates/branch-protection.spec.ts for shared policy functions and explicit false preservation. (4) Reviewed integrations/delendai validation scripts/config for the same immutable 0.3.0 pin used by the workflow. (5) Parent-provided CI evidence: frozen private plugin install completed; both TypeScript checks and all 150/150 plugin tests passed; GitHub integration workflow r… — Independent review of x00091 S1 after landed ownership correction: implementer is openai-gpt-6.1-sol; S2 remains Sol-owned and is not reviewed here. Source snapshot fa48eeec is on develop. Reused actual governed validation from prior unit: exit 0, 4917 Vitest + 15 SQLite + 41 transport = 4973/4975 (2 platform skips), journal timestamp 2026-11-09T15:37:21.268Z; not rerun in G4. Tracked source diff from validated 3e02acdb to G4 is empty outside proposal metadata. Fresh docs and proposal lints pass.

### S2 — Compatibilidad real del plugin contra el core fijado
- **Status**: done
- **DependsOn**: [S1]
- **Files**: `integrations/delendai`, `integrations/delendai/tests/integration/summary.tool.spec.ts`, `integrations/delendai/tests/integration/test.tool.spec.ts`, `tests/smoke-fixtures/asyncapi-mini/expected.json`, `tests/smoke-fixtures/grpc-mini/expected.json`, `tests/smoke-fixtures/sse-mini/expected.json`, `tests/smoke-fixtures/websocket-mini/expected.json`
- **Gate**: e2e
- acceptance:
  - "Los 150 tests del plugin pasan usando el mismo core 0.3.0 y sin tocar historiales reales."
  - "Las salidas y duraciones cumplen contratos; el test tool informa fielmente del smoke y typecheck."
- "Every registered smoke fixture has an expected baseline, including the asyncapi, grpc, sse, and websocket mini projects."
- shipped-in: `98bb120f09aa`
- review-state: done
- review-implementer: openai-gpt-6-luna
- review-reviewer: openai-gpt-6.1-sol
- review-log: approved by openai-gpt-6.1-sol — verified at bebadb7005b4, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 3/3: (1) Frozen clean archive install against immutable core0.3: both tsc checks and150/150 private plugin tests passed; GitHub integration42640433383 passed with isola… (2) Reviewed monotonic timing and actual smoke/typecheck reporting;150 private tests passed. (3) Four expected.json fixture baselines are tracked and the real smoke suite passed. — Independent Sol source review. Reused actual full validation /tmp/tanit-parent-final-validation.log timestamp2026-11-09T15:40:25.691Z:4973/4975,2skipped. Source/tests/config verified byte-identical to tested2d3 snapshot; no full rerun claimed in this fresh unit.

## acceptance

- CI lee el pin JSON y verifica su commit, sin checkout develop ni sibling obligatorio.
- La integración no modifica reglas de rama.
- El aplicador de protecciones usa las mismas funciones que el verificador y conserva false.
- La validación local del plugin usa el core fijado.
