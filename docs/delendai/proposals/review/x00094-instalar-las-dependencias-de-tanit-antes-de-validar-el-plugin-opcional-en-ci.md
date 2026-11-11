---
id: x00094
title: "Instalar las dependencias de Tanit antes de validar el plugin opcional en CI"
kind: fix
status: review
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: 3cab2cd5-365a-42d1-9653-774dcad62aa5
last-correlation-id: 3cab2cd5-365a-42d1-9653-774dcad62aa5
last-transition-from: in-progress
last-transition-at: 2026-11-09T15:00:53.250Z
shipped-in:
  - "9f10a99e38a8ea5975db6fe2dcb0a74f8a8dfc5c"
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
- shipped-in: `d2bb6e1d9e43`
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at 9f10a99e38a8, validate exit 0 and tests 3/3 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed current workflow: root frozen install (with scripts disabled) runs after checkout/setup and before the private plugin install and validation. Regressi… (2) Workflow still reads the canonical commit pin, checks out that immutable commit with persist-credentials false, installs integrations/delendai with --frozen-lo… (3) bunx vitest run tests/scripts-gates/integration-delendai-workflow.spec.ts passed 3/3 on current source. Verified the workflow and spec are unchanged between sh… — Independent review of landed workflow; focused workflow tests passed 3/3. No plugin or runtime installation was performed during this review.

## acceptance

- A clean runner installs the frozen root lockfile before installing and validating the optional plugin.
- The immutable 0.3.0 pin, private plugin lockfile and read-only workflow permissions remain enforced.
- The workflow regression test checks installation scope and dependency order.

## evidence

- Fresh source archive under a temporary directory, without inherited node_modules: frozen root install, frozen private plugin install, verified 0.3.0 runtime link, both TypeScript checks and 150/150 plugin tests passed.
- Workflow regression: 3/3 tests passed, including root install scope, dependency order and preservation of immutable runtime checkout.
