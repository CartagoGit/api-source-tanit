---
id: c00011
title: "Exponer regeneración canónica para los hooks de DelendAI sin dependencias del producto"
kind: chore
status: done
type: proposal
track: integration
date: 2026-11-10
last-transition-id: 38caadbd-e923-4881-a380-c748f0fcfa93
last-correlation-id: 38caadbd-e923-4881-a380-c748f0fcfa93
last-transition-from: review
last-transition-at: 2026-11-10T18:50:55.955Z
shipped-in:
  - "e1653ac68c18bee9e9b1fef335f71b7cbe2dc69d"
---

# c00011 — Exponer regeneración canónica para los hooks de DelendAI sin dependencias del producto

## goal

Hacer que gen:all y gen:all:check deleguen en los generadores locales existentes y dejen de fallar en cada fast-forward.

## why

El hook post-merge del runtime fijado invoca bun run gen:all, pero Tanit no declara ese comando; imprime un fallo tras cada integración. Los generadores reales de MCP, índice de propuestas y tabla de frameworks ya existen.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — S1
- **Status**: done
- **Files**: `package.json`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "gen:all reutiliza los generadores existentes de MCP, índice y tabla sin reimplementar ni crear otra fuente de datos."
  - "gen:all:check comprueba los mismos artefactos sin escribirlos y falla ante drift."
  - "Regeneración idempotente sobre árbol correcto; ningún cambio al runtime inmutable 0.3.0 ni dependencia DelendAI añadida al producto."
- shipped-in: `c8ea939b42c8`
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at e1653ac68c18, validate exit 0 and tests 3/3 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed c8ea939b42c8: gen:all is a package.json script chaining mcp:sync, lint:proposals:gen-index, and docs:frameworks. Ran bun run gen:all successfully; exi… (2) Reviewed package.json script and existing check modes. bun run gen:all:check passed all three existing checks: MCP config, proposal-index drift, and frameworks… (3) The change only edits package scripts and bootstrap docs, adding no dependency or runtime source. The generated artifacts pass gen:all:check following gen:all;… — Approved after source review and successful gen:all plus gen:all:check. These commands delegate to the existing generators and their check modes; no runtime or product dependency changed.

## acceptance

- gen:all reutiliza los generadores existentes de MCP, índice y tabla sin reimplementar ni crear otra fuente de datos.
- gen:all:check comprueba los mismos artefactos sin escribirlos y falla ante drift.
- Regeneración idempotente sobre árbol correcto; ningún cambio al runtime inmutable 0.3.0 ni dependencia DelendAI añadida al producto.
