---
id: x00077
title: "El MCP de delendai corre la rama main de delendai"
kind: fix
status: in-progress
type: proposal
track: infra
date: 2026-11-02
last-transition-id: 4fd69bfa-1b10-47ab-a3f7-34d225921fef
last-correlation-id: 4fd69bfa-1b10-47ab-a3f7-34d225921fef
last-transition-from: ready
last-transition-at: 2026-11-03T02:40:26.237Z
---

# x00077 — El MCP de delendai corre la rama main de delendai

## goal

El servidor MCP de este proyecto ejecuta la rama main de delendai con --branch=main, así que el trabajo en curso en el checkout de delendai no lo reinicia ni le cambia el código.

## why

El MCP de este proyecto ejecutaba `../delendai/...`, es decir, el checkout de delendai tal como estuviera en ese momento. Cada vez que se fusionaba algo allí, este servidor se reiniciaba sobre código recién fusionado: 23 veces el 2026-11-01, en mitad del trabajo de los agentes. Con `--branch=main`, delendai prepara la rama `main` en su propia caché y el servidor solo cambia cuando cambia `main`, al arrancar.

## non-goals

- Publicar delendai en npm: hasta entonces la bandera es el mecanismo.

## slices

- global_gate: type

### S1 — S1
- **Status**: pending
- **Files**: `.mcp.json`, `.vscode/mcp.json`
- **Gate**: type

## acceptance

- El servidor MCP arranca desde la rama `main` de delendai, y un cambio en el checkout de delendai no lo reinicia.
- `.vscode/mcp.json` se regenera desde `.mcp.json` con `mcp:sync`.
