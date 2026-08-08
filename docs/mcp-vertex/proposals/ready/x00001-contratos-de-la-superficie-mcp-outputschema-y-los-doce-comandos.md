---
id: x00001
title: "Contratos de la superficie MCP: outputSchema y los doce comandos"
kind: fix
status: ready
type: proposal
track: export-to-postman
date: 2026-08-08
---

# x00001 — Contratos de la superficie MCP: outputSchema y los doce comandos

## Goal

Que la superficie que este proyecto expone a otros agentes tenga contrato de entrada y de salida, que un gate lo exija, y que llegue a los comandos que hoy solo existen para quien usa la terminal.

## why

Hallazgos 1 (FATAL) y 18 (MINOR) de a00001. Los cuatro tools del plugin no declaran `outputSchema`, que es el invariante universal §6 que `AGENT-BOOTSTRAP.md#L62` copia por referencia y §3.2 repite con su regla de forma (`.shape`). Medido: `outputSchema:0` en los cuatro. Ningún gate lo comprueba — `lint:tsdoc` mira los exports del área pública, no la superficie MCP. Un agente que llama a `mcp-vertex_expostman_generate` recibe una salida sin contrato: no puede validar la respuesta ni saber qué campos existen sin ejecutarla y mirar. Y con solo 4 tools para 12 comandos, no puede listar endpoints, ver estadísticas, comprobar deriva (`check`) ni subir a Postman — `check` es el más llamativo, porque responde justo la pregunta que un agente querría hacer.

## non-goals

- Cambiar los nombres cualificados de los tools: son la superficie pública que despacha el host
- Reimplementar los comandos en el plugin: los tools spawnean el CLI, que es la única fuente de verdad

## Slices

- global_gate: type

### S1 — outputSchema en los cuatro tools que ya existen
- **Status**: pending
- **Files**: `projects/plugins/mcp-vertex_expostman/src/lib/tools/generate.tool.ts`, `projects/plugins/mcp-vertex_expostman/src/lib/tools/validate.tool.ts`, `projects/plugins/mcp-vertex_expostman/src/lib/tools/summary.tool.ts`, `projects/plugins/mcp-vertex_expostman/src/lib/tools/test.tool.ts`
- **Gate**: type
- acceptance:
  - "Los 4 declaran outputSchema como `.shape` de un esquema zod, sin `z.any()`"
  - "Cada campo lleva `.describe()`, que es lo que lee el agente"
  - "El plugin arranca y los 4 tools responden con una salida que valida contra su propio esquema"

### S2 — Gate que impida que vuelva a faltar
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `scripts/gates/lint-mcp-surface.script.ts`, `tests/cli/mcp-surface.spec.ts`, `package.json`
- **Gate**: lint
- acceptance:
  - "`bun run lint:mcp-surface` falla si un `*.tool.ts` no declara outputSchema"
  - "Falla también si alguno usa `z.any()`"
  - "Se comprueba quitando el outputSchema de un tool y viendo romper el gate"
  - "Entra en la cadena de `bun run lint`"

### S3 — Los ocho comandos que el plugin no expone
- **Status**: pending
- **DependsOn**: [S2]
- **Files**: `projects/plugins/mcp-vertex_expostman/src/lib/tools/check.tool.ts`, `projects/plugins/mcp-vertex_expostman/src/lib/tools/list.tool.ts`, `projects/plugins/mcp-vertex_expostman/src/lib/tools/stats.tool.ts`, `projects/plugins/mcp-vertex_expostman/src/lib/tools/scan.tool.ts`, `projects/plugins/mcp-vertex_expostman/src/index.ts`, `projects/plugins/mcp-vertex_expostman/tests/integration/check.tool.spec.ts`
- **Gate**: e2e
- acceptance:
  - "`check` responde si la colección se ha desincronizado del código, con la lista de lo que falta"
  - "`list`, `stats` y `scan` exponen lo que ya imprime el CLI, en datos y no en prosa"
  - "Cada tool nuevo nace con su outputSchema: el gate de s2 no lo deja pasar de otra forma"
  - "`push` y `open` quedan fuera a propósito y la propuesta dice por qué"

## acceptance

- Los 4 declaran outputSchema como `.shape` de un esquema zod, sin `z.any()`
- Cada campo lleva `.describe()`, que es lo que lee el agente
- El plugin arranca y los 4 tools responden con una salida que valida contra su propio esquema
- `bun run lint:mcp-surface` falla si un `*.tool.ts` no declara outputSchema
- Falla también si alguno usa `z.any()`
- Se comprueba quitando el outputSchema de un tool y viendo romper el gate
- Entra en la cadena de `bun run lint`
- `check` responde si la colección se ha desincronizado del código, con la lista de lo que falta
- `list`, `stats` y `scan` exponen lo que ya imprime el CLI, en datos y no en prosa
- Cada tool nuevo nace con su outputSchema: el gate de s2 no lo deja pasar de otra forma
- `push` y `open` quedan fuera a propósito y la propuesta dice por qué
