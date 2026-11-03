---
id: x00081
title: "el servidor MCP se llama delendai-tanit y ningun agente se queda sin sus tools por olvido"
kind: fix
status: ready
type: proposal
track: general
date: 2026-11-02
---

# x00081 — el servidor MCP se llama delendai-tanit y ningun agente se queda sin sus tools por olvido

## goal

Que el servidor MCP de este workspace se llame **`delendai-tanit`**, que
diga lo que es, y que un gate ate su nombre a los ficheros que dependen
de él.

## why

Hoy el servidor se llama `delendai`, que no dice nada: podría ser el
servidor de DelendAI a secas, o el de este proyecto, o cualquier otro.
Y en este repo hay dos consumidores de MCP con la misma etiqueta:

- la **extensión** `cartago.delendai-vscode`, que registra el servidor
  con la clave `delendai`;
- el **`.vscode/mcp.json`** del workspace, que registra el mismo
  comando con la misma clave.

Dos registros con el mismo nombre y la misma imagen: el editor los
desambigua con un sufijo, y el servidor del workspace aparece como
**`delendai2`** — un nombre que no significa nada y que aparece en
cada tool de esta sesión (`mcp_delendai2_delendai_*`).

El nombre importa por una razón concreta y documentada: la clave de
registro es la que **cualifica los nombres de las tools** en los
`.agent.md`. Los cinco agentes del repo conceden sus tools con
`tools: [read, search, …, delendai/*]`. Ese `delendai/*` es el nombre
del servidor: si la clave cambia y los grants no, **los cinco agentes
se quedan sin sus tools MCP** — y no hay ningún gate que lo diga.

Y hay un segundo motivo, más sutil: `DelendAi:Tanit` —el nombre que
parece más descriptivo— lleva dos puntos. El editor compone el
identificador de cada tool como `mcp_<servidor>_<tool>`, y el nombre
de una tool MCP está limitado a `^[a-zA-Z0-9_-]{1,64}$`. Un `:` en la
clave no es un separador: es un carácter que el nombre de una tool no
puede llevar. El guion sí.

De ahí `delendai-tanit`: dice qué es (DelendAI sirviendo este proyecto),
no usa caracteres prohibidos, y encaja con la convención que el
propio DelendAI usa para sus servidores de proyecto (`mcp-project-<ns>`).

## non-goals

- **No** se renombran las tools (`delendai_overview`,
  `delendai_proposals_*`): las nombra el servidor, no el cliente, y
  cambiarlas rompería los contratos de `docs/MCP-SURFACE.md`.
- **No** se toca la extensión de VS Code: es otro repositorio.
- **No** se cambia el comando ni los argumentos del servidor: sólo la
  clave con la que se registra.

## slices

- global_gate: type

### S1 — el nombre del servidor y el gate que lo ata a sus consumidores
- **Status**: pending
- **Files**: `.mcp.json`, `.vscode/mcp.json`, `.github/agents/orchestrator.agent.md`, `.github/agents/delivery_verifier.agent.md`, `.github/agents/implementation_runner.agent.md`, `.github/agents/proposal_guardian.agent.md`, `.github/agents/technical_investigator.agent.md`, `scripts/gates/lint-mcp-server-key.script.ts`, `tests/scripts-gates/lint-mcp-server-key.spec.ts`, `CONTRIBUTING.md`
- **Gate**: type
- acceptance:
  - "El servidor se registra con la clave `delendai-tanit` en `.mcp.json` y en el `.vscode/mcp.json` derivado."
  - "Los cinco `.agent.md` conceden sus tools con `delendai-tanit/*`, que es la clave que existe."
  - "Hay un gate que falla si algún `tools:` de un `.agent.md` concede tools de un servidor que no está registrado en `.mcp.json` — con el nombre del grant y el del servidor, para que el motivo baste."
  - "El gate también falla si `.mcp.json` y `.vscode/mcp.json` no declaran los mismos servidores."
  - "`CONTRIBUTING.md` dice cuál es la clave y por qué los grants dependen de ella."

## acceptance

- Los agentes del repo siguen teniendo sus tools MCP: el grant
  `delendai-tanit/*` casa con la clave registrada.
- Un `.agent.md` que conceda `delendai/*` (la clave vieja) hace fallar
  el gate diciendo qué clave es la buena.
- El servidor del workspace ya no aparece como `delendai2`: la
  extensión conserva `delendai` y el workspace tiene un nombre propio.
