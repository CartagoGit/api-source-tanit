---
id: x00122
title: "Resolver el MCP de Tanit desde el workspace del hilo de Codex"
kind: fix
status: in-progress
type: proposal
track: integration
date: 2026-11-21
---

# x00122 — Resolver el MCP de Tanit desde el workspace del hilo de Codex

## goal

El proceso de Codex iniciado por VS Code carga DelendAI 0.3.0 y la configuración de Tanit desde la raíz del hilo.

## why

El cwd relativo explícito fija el proceso MCP en el directorio de instalación del editor al iniciar el app-server desde WSL. Se pierde la configuración y se ejecuta el fallback del launcher.

## non-goals

- Editar VS Code global, preferencias de seguridad o cambiar la versión del runtime.

## slices

- global_gate: lint

### S1 — Generar la configuración de Codex con su directorio de hilo
- **Status**: pending
- **Files**: `scripts/gates/sync-mcp-config.script.ts`, `.codex/config.toml`, `tests/scripts-gates/lint-mcp-config.spec.ts`, `integrations/delendai/README.md`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "El TOML generado conserva DelendAI:Tanit, el comando delendai y los argumentos relativos y deja que Codex resuelva la raíz del hilo. VS Code conserva su variable workspaceFolder."
  - "El app-server del editor, iniciado desde otro directorio, carga los plugins de Tanit con el launcher fijado."

## acceptance

- El TOML generado conserva DelendAI:Tanit, el comando delendai y los argumentos relativos y deja que Codex resuelva la raíz del hilo. VS Code conserva su variable workspaceFolder.
- El app-server del editor, iniciado desde otro directorio, carga los plugins de Tanit con el launcher fijado.
