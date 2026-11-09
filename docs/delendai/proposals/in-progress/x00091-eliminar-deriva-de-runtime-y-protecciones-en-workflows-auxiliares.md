---
id: x00091
title: "Eliminar deriva de runtime y protecciones en workflows auxiliares"
kind: fix
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: 014ee437-084a-4df9-b0c7-f33a83a337dc
last-correlation-id: 014ee437-084a-4df9-b0c7-f33a83a337dc
last-transition-from: ready
last-transition-at: 2026-11-09T09:22:09.737Z
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
- **Files**: `.github/workflows/integration-delendai.yml`, `.github/workflows/protect-develop.yml`, `scripts/gates/branch-protection-payload.script.ts`, `tests/scripts-gates/integration-delendai-workflow.spec.ts`, `tests/scripts-gates/branch-protection.spec.ts`, `integrations/delendai/bun.lock`, `integrations/delendai/src/lib/contracts/plugin.interface.ts`, `integrations/delendai/src/lib/tools/check.tool.ts`, `integrations/delendai/tests/integration/check.tool.spec.ts`, `integrations/delendai/vitest.config.ts`
- **Gate**: e2e
- acceptance:
  - "CI lee el pin JSON y verifica su commit, sin checkout develop ni sibling obligatorio."
  - "La integración no modifica reglas de rama."
  - "El aplicador de protecciones usa las mismas funciones que el verificador y conserva false."
  - "La validación local del plugin usa el core fijado."
  - "The pinned plugin test suite passes after a frozen install."
- shipped-in: `7d62d54b`

### S2 — Compatibilidad real del plugin contra el core fijado
- **Status**: in-progress
- **DependsOn**: [S1]
- **Files**: `integrations/delendai/src/lib/tools/scan.tool.ts`, `integrations/delendai/src/lib/tools/test.tool.ts`, `integrations/delendai/tests/integration/summary.tool.spec.ts`, `integrations/delendai/tests/integration/test.tool.spec.ts`, `tests/smoke-fixtures/asyncapi-mini/expected.json`, `tests/smoke-fixtures/grpc-mini/expected.json`, `tests/smoke-fixtures/sse-mini/expected.json`, `tests/smoke-fixtures/websocket-mini/expected.json`
- **Gate**: e2e
- acceptance:
  - "Los 150 tests del plugin pasan usando el mismo core 0.3.0 y sin tocar historiales reales."
  - "Las salidas y duraciones cumplen contratos; el test tool informa fielmente del smoke y typecheck."
- "Every registered smoke fixture has an expected baseline, including the asyncapi, grpc, sse, and websocket mini projects."

## acceptance

- CI lee el pin JSON y verifica su commit, sin checkout develop ni sibling obligatorio.
- La integración no modifica reglas de rama.
- El aplicador de protecciones usa las mismas funciones que el verificador y conserva false.
- La validación local del plugin usa el core fijado.
