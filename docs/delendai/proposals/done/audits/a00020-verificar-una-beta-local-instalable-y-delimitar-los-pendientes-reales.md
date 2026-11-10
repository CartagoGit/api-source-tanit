---
id: a00020
title: "Verificar una beta local instalable y delimitar los pendientes reales"
kind: audit
status: done
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: ed9863f1-4038-4509-846f-7347a40bd467
last-correlation-id: ed9863f1-4038-4509-846f-7347a40bd467
last-transition-from: review
last-transition-at: 2026-11-10T18:49:59.912Z
shipped-in:
  - "e68c48cef4b942c50ef5b70eeafc22f92e21ea1c"
---

# a00020 — Verificar una beta local instalable y delimitar los pendientes reales

## goal

Comprobar desde artefactos locales el CLI autónomo, exportación Express/Laravel y web compilada; documentar evidencia y bloqueos sin confundir código preparado con entregado.

## why

TODO: why this work matters now.

## non-goals

- Publicar una versión o certificar plataformas que no se han ejecutado en esta máquina.

## slices

- global_gate: none

### S1 — Evidencia reproducible y contrato de beta cerrada
- **Status**: done
- **Files**: `docs/BETA.md`
- **Gate**: e2e
- acceptance:
  - "El binario Linux inicia sin Bun ni DelendAI en PATH."
  - "Express y Laravel exportan OpenAPI verificable desde el artefacto."
  - "La web compila y responde con su API real autenticada."
  - "Cada pendiente de beta tiene alcance y evidencia concretos."
- shipped-in: `ade9fced284f`
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at e68c48cef4b9, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 4/4: (1) docs/BETA.md records the standalone Linux binary run with PATH=/usr/bin:/bin; the parent smoke record confirms it. (2) docs/BETA.md records Express 9 operations and Laravel 19 operations, resolved local references, with rebuilt final artifacts checked. (3) docs/BETA.md records production build plus visible Chrome shell, real Express project open, and HTTP 403 for unauthenticated API requests. (4) docs/BETA.md scopes representative-repository and desktop installer checks as pending, and explicitly limits what the local smoke validates. — Independent review of the beta evidence in docs/BETA.md and the parent-provided artifact smoke record. Reused the actual governed validation from the previous review unit: exit 0, 4917 Vitest + 15 SQLite + 41 transport (4973/4975, two platform skips), journal timestamp 2026-11-09T15:37:21.268Z at the prior worktree path .cache/delendai/results/logs/validate.jsonl. I did not rerun full validation in this fresh unit. Tracked source diff from validated 3e02acdb to current unit is empty outside proposal metadata; fresh lint:docs and lint:proposals pass. Evidence includes standalone Linux binary, Express/Laravel OpenAPI, visible web export/history, auth 403, and filesystem watch.

## acceptance

- El binario Linux inicia sin Bun ni DelendAI en PATH.
- Express y Laravel exportan OpenAPI verificable desde el artefacto.
- La web compila y responde con su API real autenticada.
- Cada pendiente de beta tiene alcance y evidencia concretos.

## evidence

- Binary, web production build, real authenticated Application API, binary-to-web history visibility, real filesystem watch and isolated packed installation verified; evidence and remaining acceptance are in docs/BETA.md.
- The rebuilt final Linux artifact exports9 Express and19 Laravel operations without Bun/DelendAI in PATH; OpenAPI local references resolve and all artifact checksums pass.
- A real browser opens the project, shows9 indexed operations, generates a real file and displays its persisted revision; temporary profiles require no desktop keyring.
- The same-millisecond run collision identified by independent review is fixed and merged through x00090 (PR126).
- The optional integration uses the immutable runtime pin and common branch policy (PR127), with clean-runner root dependency installation (PR130). The real GitHub integration run42640433383 passed.
