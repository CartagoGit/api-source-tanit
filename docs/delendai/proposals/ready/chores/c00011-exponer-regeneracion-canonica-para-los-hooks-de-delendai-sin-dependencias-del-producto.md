---
id: c00011
title: "Exponer regeneración canónica para los hooks de DelendAI sin dependencias del producto"
kind: chore
status: ready
type: proposal
track: integration
date: 2026-11-10
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
- **Status**: pending
- **Files**: `package.json`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "gen:all reutiliza los generadores existentes de MCP, índice y tabla sin reimplementar ni crear otra fuente de datos."
  - "gen:all:check comprueba los mismos artefactos sin escribirlos y falla ante drift."
  - "Regeneración idempotente sobre árbol correcto; ningún cambio al runtime inmutable 0.3.0 ni dependencia DelendAI añadida al producto."

## acceptance

- gen:all reutiliza los generadores existentes de MCP, índice y tabla sin reimplementar ni crear otra fuente de datos.
- gen:all:check comprueba los mismos artefactos sin escribirlos y falla ante drift.
- Regeneración idempotente sobre árbol correcto; ningún cambio al runtime inmutable 0.3.0 ni dependencia DelendAI añadida al producto.
