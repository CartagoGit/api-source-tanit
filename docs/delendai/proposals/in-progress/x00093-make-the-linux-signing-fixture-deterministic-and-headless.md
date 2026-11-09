---
id: x00093
title: "Make the Linux signing fixture deterministic and headless"
kind: fix
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: a71e512d-4409-42b7-b2ff-a604aad14d04
last-correlation-id: a71e512d-4409-42b7-b2ff-a604aad14d04
last-transition-from: ready
last-transition-at: 2026-11-09T14:43:15.131Z
---

# x00093 — Make the Linux signing fixture deterministic and headless

## goal

Make the disposable GPG key fixture wait for its private setup and run without desktop keyring prompts while preserving real signing assertions.

## why

The signing tests generated a default RSA key synchronously after starting directory creation without awaiting it, then returned `null` on GPG errors. That hid useful diagnostics and made the local proof less reliable. The fixture should create its key in an isolated home using the existing noninteractive GPG policy.

## non-goals

- Changing the production release-signing policy or script.
- Accessing a user's keyring, desktop keyring, or real signing credentials.

## slices

- global_gate: none

### S1 — S1
- **Status**: pending
- **Files**: `tests/release/signing.spec.ts`
- **Gate**: e2e
- acceptance:
  - "The fixture awaits private GPG home setup and uses batch plus loopback pinentry."
  - "The fixture uses a fast signing-capable key supported by the runner and retains real sign/verify assertions."
  - "Failures include bounded GPG diagnostics and cleanup stops only the fixture-owned agent."

## acceptance

- The fixture awaits private GPG home setup and uses batch plus loopback pinentry.
- The fixture uses a fast signing-capable key supported by the runner and retains real sign/verify assertions.
- Failures include bounded GPG diagnostics and cleanup stops only the fixture-owned agent.
