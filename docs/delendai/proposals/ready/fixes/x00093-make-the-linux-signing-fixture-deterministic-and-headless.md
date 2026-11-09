---
id: x00093
title: "Make the Linux signing fixture deterministic and headless"
kind: fix
status: ready
type: proposal
track: api-source-tanit
date: 2026-11-09
---

# x00093 — Make the Linux signing fixture deterministic and headless

## goal

Make the disposable GPG key fixture wait for its private setup and run without desktop keyring prompts while preserving real signing assertions.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

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
