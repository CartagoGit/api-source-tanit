---
id: x00077
title: "El MCP de delendai corre la rama main de delendai"
kind: fix
status: done
type: proposal
track: infra
date: 2026-11-02
last-transition-id: 707ce632-6f41-4549-b600-66819d796e3f
last-correlation-id: 707ce632-6f41-4549-b600-66819d796e3f
last-transition-from: review
last-transition-at: 2026-11-03T06:38:16.011Z
shippedIn:
  - "fed5f2121a20"


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
- review-implementer: claude-opus-5-5
- review-reviewer: minimax-m3.1-flash
- review-log: approved by minimax-m3.1-flash — verified at fed5f2121a20, validate exit 0 and tests 7/7 claimed, no recorded run cited — Revisión independiente de la entrega fed5f212 (el MCP corre la rama main de delendai), entregada por claude-opus-5-5. .mcp.json pasa --branch=main al host-server, así que el MCP sigue la rama main de delendai y un cambio en su checkout deja de reiniciarlo; .vscode/mcp.json es el derivado de aquél. Ejecuté los specs que cubren la configuración MCP: tests/scripts-gates/lint-mcp-config.spec.ts da 7/7 en verde, y el gate lint:mcp dice que los dos ficheros declaran el mismo servidor.

## acceptance

- El servidor MCP arranca desde la rama `main` de delendai, y un cambio en el checkout de delendai no lo reinicia.
- `.vscode/mcp.json` se regenera desde `.mcp.json` con `mcp:sync`.
