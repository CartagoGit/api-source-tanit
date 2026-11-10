---
id: t00006
title: "Fijar el tiempo de creación de claves GPG efímeras frente a saltos de reloj"
kind: test
status: review
type: proposal
track: quality
date: 2026-11-10
last-transition-id: 6383e7f0-5d0d-41c2-ae88-c45aa7b692c8
last-correlation-id: 6383e7f0-5d0d-41c2-ae88-c45aa7b692c8
last-transition-from: in-progress
last-transition-at: 2026-11-10T07:30:38.377Z
shipped-in:
  - "e1653ac68c18bee9e9b1fef335f71b7cbe2dc69d"
---

# t00006 — Fijar el tiempo de creación de claves GPG efímeras frente a saltos de reloj

## goal

Evitar fallos Time conflict en fixtures sin relajar verificaciones de firma del producto.

## why

La entrega aislada del fix AST falló en createThrowawayKeyring porque la clave era un segundo futura durante su autofirma. El mismo código pasó previamente la validación completa. GPG compara tiempos dentro de generación y un reloj WSL que retrocede puede romper la fixture.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — S1
- **Status**: done
- **Files**: `tests/release/signing.spec.ts`
- **Gate**: e2e
- acceptance:
  - "La fixture genera claves con reloj de prueba estable anterior al actual; firmas y verificadores reales conservan sus comprobaciones de tiempo."
  - "La suite de firma real valida claves protegidas y no protegidas sin pinentry gráfico, sin cambiar el almacén personal ni ignorar Time conflict."
  - "No modificar scripts de firma o validación de producción para ocultar la condición."
- shipped-in: `541f4709d008`
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at e1653ac68c18, validate exit 0 and tests 46/47 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed tests/release/signing.spec.ts: --faked-system-time is applied only to ephemeral-key creation; signing and verifier checks use their normal real-clock … (2) Ran `bunx vitest run tests/release/signing.spec.ts`: 46 passed, 1 skipped, 47 total, exit 0. The fixture uses a temporary GNUPGHOME and loopback pinentry; real… (3) Reviewed `git show --stat 541f4709`: the change adds the fixture clock option in the test file and bootstrap text only; no production signer or verifier script… — Independent x00006 S1 review on landed develop snapshot e1653ac68c18bee9e9b1fef335f71b7cbe2dc69d. The targeted Vitest file passed 46/47 (one platform skip), exit 0; no full-suite result is claimed. Source review confirms the fake time is limited to ephemeral test-key creation.

## acceptance

- La fixture genera claves con reloj de prueba estable anterior al actual; firmas y verificadores reales conservan sus comprobaciones de tiempo.
- La suite de firma real valida claves protegidas y no protegidas sin pinentry gráfico, sin cambiar el almacén personal ni ignorar Time conflict.
- No modificar scripts de firma o validación de producción para ocultar la condición.
