---
id: x00001
title: "Contratos de la superficie MCP: del esquema correcto a la superficie util"
kind: fix
status: ready
type: proposal
track: export-to-postman
date: 2026-08-08
---

> **Parcial a 2026-08-08.** S1 y S2 entregados: los cuatro tools
> declaran `outputSchema` y `lint:mcp-surface` lo exige. Al obligar al
> contrato salieron dos bugs más — `summary` declaraba 6 campos y
> devolvía 18, y `validate` reportaba una colección desincronizada como
> *fallo de herramienta*.
>
> De S3 va el tool que más falta hacía, **`check`**. Quedan `list`,
> `stats` y `scan`, que son mecánicos ahora que el patrón está: extraer
> el `run*()` del comando y envolverlo.

# x00001 — Contratos de la superficie MCP: del esquema correcto a la superficie útil

## Goal

Que la superficie que este proyecto expone a otros agentes tenga contrato de entrada y de salida, pruebas integradas del contrato que hoy ya existe, y una amplitud de tools suficiente para que el MCP sirva de verdad como puerta de entrada al producto.

## why

Hallazgo 18 (MINOR) de a00001, más la recalibración de la auditoría 2026-08-08. El árbol actual ya no está donde nació esta propuesta: los cuatro tools del plugin sí declaran `outputSchema`, `lint:mcp-surface` existe y hoy pasa, y `tests/cli/mcp-surface.spec.ts` ya verifica una parte del contrato. Eso es una buena noticia, pero deja al descubierto la deuda que ahora sí es la principal: la superficie MCP sigue siendo estrecha para lo que el producto sabe hacer. Un agente puede generar, resumir, validar y testear; no puede pedir `check`, `list`, `stats`, `scan`, `push` o `init` en datos estructurados. Y lo ya resuelto aún no tiene la prueba integrada que demuestre que lo registrado en el plugin valida de verdad contra los esquemas en ejecución, no solo como texto en un fichero.

## non-goals

- Cambiar los nombres cualificados de los tools: son la superficie pública que despacha el host
- Reimplementar los comandos en el plugin: los tools spawnean el CLI, que es la única fuente de verdad

## Slices

- global_gate: type

### S1 — Prueba integrada del contrato que el árbol actual ya declara
- **Status**: pending
- **Files**: `projects/plugins/mcp-vertex_expostman/tests/integration/generate.tool.spec.ts`, `projects/plugins/mcp-vertex_expostman/tests/integration/summary.tool.spec.ts`, `projects/plugins/mcp-vertex_expostman/tests/integration/validate.tool.spec.ts`, `projects/plugins/mcp-vertex_expostman/tests/integration/test.tool.spec.ts`
- **Gate**: plugin
- acceptance:
  - "El plugin arranca y los 4 tools responden con una salida que valida contra su propio esquema"
  - "La prueba falla si el handler devuelve más o menos campos que el esquema"
  - "La propuesta deja de perseguir una deuda ya cerrada en texto y persigue la garantía ejecutable que aún falta"

### S2 — Los tools de solo lectura que hoy faltan
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `projects/plugins/mcp-vertex_expostman/src/lib/tools/check.tool.ts`, `projects/plugins/mcp-vertex_expostman/src/lib/tools/list.tool.ts`, `projects/plugins/mcp-vertex_expostman/src/lib/tools/stats.tool.ts`, `projects/plugins/mcp-vertex_expostman/src/lib/tools/scan.tool.ts`, `projects/plugins/mcp-vertex_expostman/src/index.ts`, `projects/plugins/mcp-vertex_expostman/tests/integration/check.tool.spec.ts`
- **Gate**: plugin
- acceptance:
  - "`check` responde si la colección se ha desincronizado del código, con la lista de lo que falta"
  - "`list`, `stats` y `scan` exponen lo que ya imprime el CLI, en datos y no en prosa"
  - "Cada tool nuevo nace con `outputSchema` y con prueba integrada"

### S3 — Las operaciones útiles pero no triviales: `push` e `init`
- **Status**: pending
- **DependsOn**: [S2]
- **Files**: `projects/plugins/mcp-vertex_expostman/src/lib/tools/push.tool.ts`, `projects/plugins/mcp-vertex_expostman/src/lib/tools/init.tool.ts`, `projects/plugins/mcp-vertex_expostman/src/lib/contracts/plugin.interface.ts`, `projects/plugins/mcp-vertex_expostman/tests/integration/push.tool.spec.ts`
- **Gate**: e2e
- acceptance:
  - "`init` permite a un agente scaffoldar una configuración válida sin parsear stdout humano"
  - "`push` devuelve resultado estructurado y no filtra secretos en errores ni trazas"
  - "Si alguno se descarta, la propuesta deja escrita la razón"

### S4 — Decisión explícita sobre lo que NO debe ser una tool MCP
- **Status**: pending
- **DependsOn**: [S3]
- **Files**: `docs/mcp-vertex/proposals/ready/DECISION-mcp-surface.md`
- **Gate**: none
- acceptance:
  - "`watch`, `open` y cualquier comando side-effect-heavy quedan incluidos o excluidos con criterio escrito"
  - "La superficie MCP deja de crecer por intuición y pasa a crecer por contrato"

## acceptance

- El plugin arranca y los 4 tools responden con una salida que valida contra su propio esquema
- La prueba falla si el handler devuelve más o menos campos que el esquema
- `check` responde si la colección se ha desincronizado del código, con la lista de lo que falta
- `list`, `stats` y `scan` exponen lo que ya imprime el CLI, en datos y no en prosa
- Cada tool nuevo nace con su outputSchema y con prueba integrada
- `init` permite a un agente scaffoldar una configuración válida sin parsear stdout humano
- `push` devuelve resultado estructurado y no filtra secretos en errores ni trazas
- `watch`, `open` y cualquier otro comando side-effect-heavy quedan incluidos o excluidos con criterio escrito
