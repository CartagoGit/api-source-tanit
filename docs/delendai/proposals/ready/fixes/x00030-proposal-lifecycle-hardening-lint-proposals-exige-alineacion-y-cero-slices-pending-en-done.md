---
id: x00030
title: "Proposal lifecycle hardening - lint:proposals exige alineacion y cero slices pending en done"
kind: fix
status: ready
type: proposal
track: general
date: 2026-09-04
---

# x00030 — Proposal lifecycle hardening - lint:proposals exige alineacion y cero slices pending en done

## Goal

Endurecer lint:proposals para que done signifique acceptance demostrada, no slices implementadas. El estado actual permite cerrar propuestas (status: done) con slices - **Status**: pending en su propio cuerpo, y el INDEX.md se desincroniza del filesystem porque sync_proposals es manual.

## why

El agente cerro a00014/a00015/a00016/x00025 con status: done pero cada uno sigue teniendo Status: pending en sus slices. El INDEX.md mostraba a00014/15/16/b00001 como Ready aunque ya estaban en done/. La causa raiz es que lint:proposals no impone las invariantes basicas de alineacion entre frontmatter, filesystem e INDEX. Esto permite que el sistema de propuestas funcione con varias fuentes de verdad contradictorias.

## non-goals

- No cambia el state machine de transiciones (esa es otra propuesta)
- No fuerza shippedIn no vacio (eso seria un cambio de aceptacion por propuesta)
- No modifica el formato de frontmatter

## Slices

- global_gate: lint

### S1 — Auditar, extraer invariantes y endurecer lint:proposals
- **Status**: pending
- **Files**: `scripts/gates/lint-proposals.script.ts`
- **Gate**: lint

### S2 — Documentar las invariantes en docs/delendai/proposals/README.md
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `docs/delendai/proposals/README.md`
- **Gate**: lint

## acceptance

- TODO: observable acceptance criteria.
