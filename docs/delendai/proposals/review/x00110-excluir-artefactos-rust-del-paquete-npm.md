---
id: x00110
title: "Excluir artefactos Rust del paquete npm"
kind: fix
status: review
type: proposal
track: general
date: 2026-11-19
last-transition-id: 565d7c24-9013-41c1-b9ff-e5a6945aa283
last-correlation-id: 565d7c24-9013-41c1-b9ff-e5a6945aa283
last-transition-from: in-progress
last-transition-at: 2026-11-19T07:45:08.132Z
shipped-in:
  - "9f1de060c47c96616704467aa639e1707587f8f3"
---

# x00110 — Excluir artefactos Rust del paquete npm

## goal

Excluir packages/desktop/target del paquete preservando los archivos distribuibles.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: lint

### S1 — Excluir target y comprobar packlist
- **Status**: done
- **Files**: `package.json`, `tests/scripts-gates/package-packlist.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: none
- acceptance:
  - "npm pack excluye target y conserva Rust, core y Angular usando el manifiesto real."
  - "Validación de paquete y prueba focal superadas."
- shipped-in: `d0a9d3300905`
- review-state: done
- review-implementer: openai-gpt-6.1-terra
- review-reviewer: openai-gpt-6.1-sol
- review-log: approved by openai-gpt-6.1-sol — verified at 9f1de060c47c, validate exit 0 and tests 1/1 claimed, no recorded run cited; acceptance 2/2: (1) package.json exclusion y spec copian PACKAGE_JSON real, cuatro probes; npm pack --dry-run --json --ignore-scripts: test local 1/1 pass. (2) Vitest focal local 1/1 exit 0; CI 44483415329 head 9f1de060 validate-package success ejecutó validate:package. — Revisados 28681249, d0a9d330 y #182 b864ffab integrado 9f1de060. Exclusion files !packages/desktop/target; prueba copia manifiesto real, crea probes target/Rust/core/Angular y verifica npm pack dry-run real. Ejecuté bunx vitest run tests/scripts-gates/package-packlist.spec.ts en unidad review: 1/1 pass, exit 0; estos archivos no cambiaron desde entrega. CI exacta 44483415329 success, incluye validate-package ejecutando bun run validate:package y test-coverage; reutilizada sin repetir suite global. Cambios posteriores 5567e815,99a2a59a,717ee23b afectan bootstrap/planner, no defecto de entrega. Gate declarado none.

## acceptance

- npm pack excluye target y conserva Rust, core y Angular usando el manifiesto real.
- Validación de paquete y prueba focal superadas.
