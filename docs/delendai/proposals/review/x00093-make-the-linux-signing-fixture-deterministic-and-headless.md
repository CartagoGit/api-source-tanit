---
id: x00093
title: "Make the Linux signing fixture deterministic and headless"
kind: fix
status: review
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: 0d5fda69-6cf0-4ea9-b34d-be3c0d8eb867
last-correlation-id: 0d5fda69-6cf0-4ea9-b34d-be3c0d8eb867
last-transition-from: in-progress
last-transition-at: 2026-11-09T14:48:51.620Z
shipped-in:
  - "bebadb7005b46141961d4924c96e8a97268ad2d5"
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
- **Status**: done
- **Files**: `tests/release/signing.spec.ts`
- **Gate**: e2e
- acceptance:
  - "The fixture awaits private GPG home setup and uses batch plus loopback pinentry."
  - "The fixture uses a fast signing-capable key supported by the runner and retains real sign/verify assertions."
  - "Failures include bounded GPG diagnostics and cleanup stops only the fixture-owned agent."
- shipped-in: `55b74ac8452a`
- review-state: done
- review-implementer: openai-gpt-6-luna
- review-reviewer: openai-gpt-6.1-sol
- review-log: approved by openai-gpt-6.1-sol — verified at bebadb7005b4, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed awaited0700 mkdir and batch/no-tty/loopback; actual cryptographic signing tests passed without GUI prompts. (2) Reviewed Ed25519 key and unchanged sign/verify assertions; local GPG2.2.27 and PR128 CI passed. (3) Reviewed bounded diagnostics and cleanup scoped to explicit fixture GNUPGHOME; no user keyring is modified. — Independent Sol source review. Reused actual full validation /tmp/tanit-parent-final-validation.log timestamp2026-11-09T15:40:25.691Z:4973/4975,2skipped. Source/tests/config verified byte-identical to tested2d3 snapshot; no full rerun claimed in this fresh unit.

## acceptance

- The fixture awaits private GPG home setup and uses batch plus loopback pinentry.
- The fixture uses a fast signing-capable key supported by the runner and retains real sign/verify assertions.
- Failures include bounded GPG diagnostics and cleanup stops only the fixture-owned agent.
