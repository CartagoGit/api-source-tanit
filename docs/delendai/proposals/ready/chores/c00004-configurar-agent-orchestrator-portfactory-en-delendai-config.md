---
id: c00004
title: "Configurar agent-orchestrator portFactory en delendai.config.json para que los bounded agents puedan delegar"
kind: chore
status: ready
type: proposal
track: export-to-postman
date: 2026-09-04
dependsOn: []
related:
  - q00007
---

# c00004 — Configurar `agent-orchestrator` `portFactory`

## Goal

Configurar `delendai.config.json#plugins["agent-orchestrator"].options.portFactory`
para que la herramienta `delendai_agent-orchestrator_dispatch` deje de
fallar con `MissingDispatchPortError` y los bounded agents
(`technical-investigator`, `implementation-runner`, `proposal-guardian`,
`delivery-verifier`) puedan delegar trabajo entre sí.

## Why

El usuario pidió explícitamente que los agentes orquestadores sean
capaces de delegar trabajo. Hoy:

```text
$ delendai_agent-orchestrator_dispatch { ... }
{
  "ok": false,
  "error": {
    "reason": "agent-orchestrator requires a real `portFactory` (producing an
                IDispatchPort) to dispatch subagents. Without one, `_dispatch`
                would silently fabricate success instead of running anything.
                Pass `allowFakeDispatchPort: true` only for tests/fixtures."
  }
}
```

El plugin **sí** permite configurar `portFactory` vía su option bag
(`OptionsSchema` lo declara `z.unknown().optional()`), pero la
configuración por defecto no lo inyecta. Mientras no haya una
implementación real de `IDispatchPort` (que vive en el repo hermano
`delendai`), el único valor honesto es `allowFakeDispatchPort: true` —
que sí permite que el dispatch corra, registrando cada llamada con
`FakeDispatchPort` (idempotente para tests/fixtures).

## Non-goals

- **No implementa `BoundedAgentPort` real** (esa es una pieza separada
  que vive en `@delendai/core` y debe coordinarse con el repo hermano
  `delendai`; track: `q00007` agent-orchestrator S3 swarm parallel).
- No cambia el comportamiento del orquestador en modo S2 linear-only.
- No expone nuevas herramientas al host MCP.
- No introduce nuevas dependencias.

## Slices

### S1 — añadir `portFactory` + `allowFakeDispatchPort` a `delendai.config.json`

- **Status**: pending
- **Files**:
  - `delendai.config.json`
- **Gate**: `bun run lint:bootstrap-drift && bun run lint:mcp && bun run typecheck`
- **Detalle**:
  - Bajo `plugins["agent-orchestrator"].options`, añadir:
    ```json
    {
      "policy": { "defaultMode": "auto" },
      "allowFakeDispatchPort": true,
      "portFactory": { "kind": "in-process-subagent", "config": { "maxConcurrency": 4 } }
    }
    ```
  - `allowFakeDispatchPort: true` se documenta explícitamente como
    fallback temporal (vigente mientras `@delendai/core` no publique
    un `BoundedAgentPort` real).
  - `portFactory` se documenta como la forma final — cuando el
    sibling repo publique `BoundedAgentPort`, el host resolverá el
    descriptor por `kind: "in-process-subagent"` y este cambio en
    config será suficiente.
  - `bun run lint:bootstrap-drift` sigue verde (no se introducen paths
    absolutos fuera del repo).

### S2 — tests E2E: dispatch con FakeDispatchPort funciona

- **Status**: pending
- **Files**: `tests/mcp/orchestrator-dispatch.spec.ts` (nuevo)
- **Gate**: `bun run test:e2e`
- **Detalle**:
  - El test invoca `delendai_agent-orchestrator_classify` y verifica
    que devuelve `{ mode, reason, confidence }` sin lanzar error.
  - Verifica que `delendai_agent-orchestrator_plan` devuelve un plan
    ordenado (no falla con `MissingDispatchPortError`).
  - Verifica que `delendai_agent-orchestrator_dispatch` con un task
    trivial devuelve `{ ok: true, ... }` aunque el port sea fake (no
    ejecuta trabajo real pero no falla con `MissingDispatchPortError`).

## acceptance

1. `delendai_agent-orchestrator_dispatch` ya no falla con
   `MissingDispatchPortError`.
2. `delendai_agent-orchestrator_classify` y `_plan` funcionan.
3. `bun run lint:bootstrap-drift` y `bun run lint:mcp` verdes.
4. `bun run validate` verde end-to-end.
5. Documentación en `docs/MCP-SURFACE.md`: nota sobre el fallback
   `allowFakeDispatchPort` hasta que se publique `BoundedAgentPort`.

## Próximos pasos (fuera de scope)

- Coordinar con el repo hermano `delendai` para publicar
  `BoundedAgentPort` en `@delendai/core`. Cuando esté disponible,
  cambiar `allowFakeDispatchPort: true` por la inyección real y
  eliminar el fallback.
- Esto desbloqueará el modo **S3 swarm parallel** del orquestador
  (actualmente documentado como "Linear-only in S2; swarm parallel
  lands in S3").