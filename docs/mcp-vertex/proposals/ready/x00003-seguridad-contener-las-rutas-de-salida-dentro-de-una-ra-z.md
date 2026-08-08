---
id: x00003
title: "Seguridad: contener las rutas de salida dentro de una raíz"
kind: fix
status: ready
type: proposal
track: export-to-postman
date: 2026-08-08
---

# x00003 — Seguridad: contener las rutas de salida dentro de una raíz

## Goal

Que una ruta de salida no pueda escribir fuera de donde se espera cuando quien la elige es un agente, sin estorbar a quien usa el CLI a mano con una ruta absoluta legítima.

## why

Hallazgo 7 (BAD) de a00001. `--output-dir` y `POSTMAN_OUTPUT_DIR` se aceptan tal cual: no hay ninguna validación de contención en `paths.service.ts`, ni `startsWith(root)` ni un `relative()` que compruebe que no empieza por `..`. En un CLI que ejecuta una persona sobre su propia máquina eso es razonable. Pero el plugin MCP spawnea este mismo CLI con argumentos que vienen de un agente, y ahí quien decide la ruta ya no es necesariamente la persona. El brief canónico lo clasifica como FATAL cuando la entrada no se valida contra la raíz del workspace; aquí se queda en BAD porque la superficie expuesta es el plugin y no un servidor abierto, pero la corrección es la misma y es barata.

## non-goals

- Restringir el CLI cuando lo lanza una persona: `--output-dir /tmp/lo-que-sea` es un uso legítimo y se queda
- Sandbox de lectura: los scanners leen el proyecto que se les pide y eso es su trabajo

## Slices

- global_gate: type

### S1 — La comprobación de contención, pura y probada
- **Status**: pending
- **Files**: `projects/core/helpers/path-containment.helper.ts`, `tests/core/path-containment.helper.spec.ts`
- **Gate**: type
- acceptance:
  - "Resuelve enlaces simbólicos antes de comparar: `/tmp/enlace/..` no puede colarse"
  - "Un test cubre `../`, rutas absolutas fuera, el propio directorio raíz y un prefijo que coincide sin ser padre (`/a/raiz-mala` contra `/a/raiz`)"
  - "Es una función pura: decide, no escribe"

### S2 — El CLI la aplica cuando quien pide es un agente
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `projects/core/discovery/paths.service.ts`, `projects/plugins/mcp-vertex_expostman/src/lib/helpers/runner.helper.ts`, `tests/core/output-containment.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Una ruta que se sale de la raíz se rechaza con mensaje claro y código 1, no con una traza"
  - "El plugin no puede inducir una escritura fuera del workspace, y hay un test que lo intenta"
  - "Quien lanza el CLI a mano con una ruta absoluta sigue pudiendo"

## acceptance

- Resuelve enlaces simbólicos antes de comparar: `/tmp/enlace/..` no puede colarse
- Un test cubre `../`, rutas absolutas fuera, el propio directorio raíz y un prefijo que coincide sin ser padre (`/a/raiz-mala` contra `/a/raiz`)
- Es una función pura: decide, no escribe
- Una ruta que se sale de la raíz se rechaza con mensaje claro y código 1, no con una traza
- El plugin no puede inducir una escritura fuera del workspace, y hay un test que lo intenta
- Quien lanza el CLI a mano con una ruta absoluta sigue pudiendo
