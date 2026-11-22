---
id: x00130
title: "Explorar proyectos backend con errores recuperables"
kind: fix
status: review
type: proposal
track: ux
date: 2026-11-22
last-transition-id: 999fbfd2-a998-488a-8e46-c0e0e0180694
last-correlation-id: 999fbfd2-a998-488a-8e46-c0e0e0180694
last-transition-from: in-progress
last-transition-at: 2026-11-22T00:23:56.857Z
shipped-in:
  - "0d211bd064221ee796cde34bcb34b3a5025500fe"
---

# x00130 — Explorar proyectos backend con errores recuperables

## goal

Distinguir la exploración web sin servicio local, la web conectada y el escritorio.

## why

Una solicitud de exploración sin respuesta bloquea los controles y puede mostrar un timeout genérico.

## non-goals

- Acceso a carpetas del visitante desde una web estática.
- Comparar contratos de apps detectadas.

## slices

- global_gate: lint

### S1 — Acotar esperas y explicar la selección de carpetas
- **Status**: done
- **Files**: `packages/app/src/app/core/api/host-bridge.client.ts`, `packages/app/src/app/core/i18n/locales/en.json`, `packages/app/src/app/core/i18n/locales/es.json`, `packages/app/src/app/core/i18n/locales/fr.json`, `packages/app/src/app/features/home/folder-picker.component.ts`, `packages/app/src/app/features/home/folder-picker.component.html`, `tests/app/host-bridge.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "La web sin la API local muestra una explicación específica y recupera los controles."
  - "El explorador conserva errores de la API y permite reintentar tras un timeout web o de escritorio."
  - "La selección explica cómo abrir un backend o la raíz de un monorepo."
- shipped-in: `73bcc98e813c`
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at 0d211bd06422, validate exit 0 and tests 17/17 claimed, no recorded run cited; acceptance 3/3: (1) Reused the browser static-site smoke and the host-bridge static response/retry transport test from the supplied evidence. (2) Reused the 17/17 host-bridge tests, including desktop/browser timeout cancellation, browser retry and preserved Application API errors; static and loopback bro… (3) Reviewed the translated folder-picker guidance in the integrated diff; production Angular build and compiled .htaccess check succeeded. — Independent positive review of integrated PR #230 at 0d211bd064221ee796cde34bcb34b3a5025500fe. Reused the supplied evidence: 17/17 app transport tests, successful official DelendAI work proof (validate exit 0), production Angular build and compiled .htaccess check, exact PR ci-summary at this head, and passing static-site plus real loopback Application API browser smoke. Reviewed the change; no blocking defect.

## acceptance

- La web sin la API local muestra una explicación específica y recupera los controles.
- El explorador conserva errores de la API y permite reintentar tras un timeout web o de escritorio.
- La selección explica cómo abrir un backend o la raíz de un monorepo.
