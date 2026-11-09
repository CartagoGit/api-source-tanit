---
id: x00084
title: "Configuración de sesión efectiva, parcial y atómica"
kind: fix
status: done
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: 6ec4c0d9-dea9-4460-b358-39fae61ff2e8
last-correlation-id: 6ec4c0d9-dea9-4460-b358-39fae61ff2e8
last-transition-from: review
last-transition-at: 2026-11-09T15:43:43.594Z
shipped-in:
  - "e68c48cef4b942c50ef5b70eeafc22f92e21ea1c"
---

# x00084 — Configuración de sesión efectiva, parcial y atómica

## goal

CLI y app consultan y modifican una única configuración efectiva de sesión sin perder opciones ni la sesión válida ante fallos.

## why

settings.handlers.ts cierra la sesión antes del reemplazo, reconstruye sólo el parche y no devuelve la nueva identidad. El GET no expone opciones efectivas.

## non-goals

- No añadir preferencias de presentación al núcleo.

## slices

- global_gate: e2e

### S1 — Preservar configuración y sesión al aplicar parches
- **Status**: done
- **Files**: `packages/core/application-api/settings.handlers.ts`, `packages/core/session/project-session.service.ts`, `packages/core/session/session-events.ts`, `packages/contracts/interfaces/core/session.interface.ts`, `packages/contracts/interfaces/core/application-api.interface.ts`, `tests/application-api/settings.handlers.spec.ts`, `tests/core/session/session-lifecycle.spec.ts`, `docs/API.md`
- **Gate**: e2e
- acceptance:
  - "Cambiar una opción conserva todas las demás."
  - "GET devuelve configuración efectiva compartida."
  - "Un reemplazo fallido conserva la sesión anterior utilizable."
  - "La respuesta permite al cliente seguir usando la sesión vigente."

- implementation-commits: `c53747ab9d35fbc2eee0fd9c6e7d66b24de5a5c2`, `6999c1a901d36c2ad095a3d8d3f1c1399eaeecd8`
- evidence: 69 focused tests passed across settings, shared handler, session and lifecycle specs; all six typecheck sections passed for settings, and core typecheck passed after lifecycle changes. Contracts, naming, boundary and type-escape gates passed. The existing session identity and listeners survive configuration changes; watch-only changes avoid rescanning; failed or aborted candidate scans preserve the previous snapshot/options. Direct/global close emits typed lifecycle notification once and releases resources even when an observer fails.
- proof: governed full validation initially detected stale generated API documentation after session API changes; regenerated docs/API.md from source and committed it before repeating proof.
- shipped-in: `ea20040ca507`
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at e68c48cef4b9, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 4/4: (1) Reviewed the shipped implementation and its focused regression checks for this criterion in the merged source snapshot; current full governed validation passed… (2) Reviewed the shipped implementation and its focused regression checks for this criterion in the merged source snapshot; current full governed validation passed… (3) Reviewed the shipped implementation and its focused regression checks for this criterion in the merged source snapshot; current full governed validation passed… (4) Reviewed the shipped implementation and its focused regression checks for this criterion in the merged source snapshot; current full governed validation passed… — Independent review of merged develop snapshot e68c48cef4b9; fresh validate in review worktree passed at 2026-11-09T15:37:21.268Z (exit 0), 4917 Vitest + 15 SQLite + 41 transport; 2 platform skips. Journal: .cache/delendai/results/logs/validate.jsonl.

## acceptance

- Cambiar una opción conserva todas las demás.
- GET devuelve configuración efectiva compartida.
- Un reemplazo fallido conserva la sesión anterior utilizable.
- La respuesta permite al cliente seguir usando la sesión vigente.
