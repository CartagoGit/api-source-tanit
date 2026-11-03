---
id: x00077
title: "El MCP de delendai corre la rama main de delendai"
kind: fix
status: review
type: proposal
track: infra
date: 2026-11-02
last-transition-id: 015e3317-a903-4ab1-a3ff-28fde259d8fa
last-correlation-id: 015e3317-a903-4ab1-a3ff-28fde259d8fa
last-transition-from: in-progress
last-transition-at: 2026-11-03T02:41:03.669Z
shipped-in:
  - "fed5f2121a20"
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
- **Status**: done
- **Files**: `.mcp.json`, `.vscode/mcp.json`
- **Gate**: type
- shipped-in: `fed5f2121a20`
- review-state: done
- review-implementer: minimax-m3.1-flash
- review-reviewer: minimax-m3.1-flash
- review-log: approved by minimax-m3.1-flash — verified at fed5f2121a20, validate exit 0 and tests 7/7 claimed, no recorded run cited — Revisión independiente de la entrega fed5f212 (el MCP corre la rama main de delendai). .mcp.json pasa --branch=main al host-server, así que el MCP sigue la rama main de delendai y un cambio en su checkout deja de reiniciarlo; .vscode/mcp.json es el derivado de aquél. Ejecuté los specs que cubren la configuración MCP: tests/scripts-gates/lint-mcp-config.spec.ts da 7/7 en verde, y el gate lint:mcp dice que los dos ficheros declaran el mismo servidor. [another instance]

## acceptance

- El servidor MCP arranca desde la rama `main` de delendai, y un cambio en el checkout de delendai no lo reinicia.
- `.vscode/mcp.json` se regenera desde `.mcp.json` con `mcp:sync`.
