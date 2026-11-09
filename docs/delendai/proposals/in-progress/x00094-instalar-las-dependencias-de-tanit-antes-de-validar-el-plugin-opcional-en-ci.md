---
id: x00094
title: "Instalar las dependencias de Tanit antes de validar el plugin opcional en CI"
kind: fix
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: e9b6f2a7-f21e-4e5f-b40d-479f47a78ad5
last-correlation-id: e9b6f2a7-f21e-4e5f-b40d-479f47a78ad5
last-transition-from: ready
last-transition-at: 2026-11-09T14:58:23.836Z
---

# x00094 — Instalar las dependencias de Tanit antes de validar el plugin opcional en CI

## goal

Reproducir la integración opcional en un runner limpio con dependencias raíz y runtime inmutable 0.3.0.

## why

The first clean GitHub run (42636714514) failed TypeScript resolution for zod and Babel because the optional plugin imports Tanit source outside its private package. Local root dependencies concealed this missing workflow step.

## non-goals

- No runtime upgrade, product dependency on DelendAI, or permission expansion.

## slices

- global_gate: none

### S1 — Install the host product dependencies before plugin validation
- **Status**: done
- **Files**: `.github/workflows/integration-delendai.yml`, `tests/scripts-gates/integration-delendai-workflow.spec.ts`
- **Gate**: cli

## acceptance

- A clean runner installs the frozen root lockfile before installing and validating the optional plugin.
- The immutable 0.3.0 pin, private plugin lockfile and read-only workflow permissions remain enforced.
- The workflow regression test checks installation scope and dependency order.

## evidence

- Fresh source archive under a temporary directory, without inherited node_modules: frozen root install, frozen private plugin install, verified 0.3.0 runtime link, both TypeScript checks and 150/150 plugin tests passed.
- Workflow regression: 3/3 tests passed, including root install scope, dependency order and preservation of immutable runtime checkout.
