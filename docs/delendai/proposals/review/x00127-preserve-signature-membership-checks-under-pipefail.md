---
id: x00127
title: "Preserve signature membership checks under pipefail"
kind: fix
status: review
type: proposal
track: release
date: 2026-11-21
last-transition-id: 3d454498-5579-4ede-a3e0-aefe967c06e7
last-correlation-id: 3d454498-5579-4ede-a3e0-aefe967c06e7
last-transition-from: in-progress
last-transition-at: 2026-11-21T05:17:05.582Z
---

# x00127 — Preserve signature membership checks under pipefail

## goal

Avoid SIGPIPE false negatives when checking manifest artifact membership in the signature verifier.

## why

With pipefail, grep -q can exit early and make printf fail with EPIPE, falsely rejecting a described .deb.sig.

## non-goals

- No signature policy changes
- No credential or release configuration changes

## slices

- global_gate: lint

### S1 — Use direct here-string membership check
- **Status**: review
- **Files**: `scripts/release/verify-signature.sh`, `tests/release/signing.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: type
- acceptance:
  - "Manifest membership remains exact whole-line matching."
  - "The verifier no longer treats grep early exit as a producer failure under pipefail."
- review-state: in_review
- review-implementer: openai-gpt-5.6-luna
- shipped-in: `8d7de8d27010`

## acceptance

- Manifest membership remains exact whole-line matching.
- The verifier no longer treats grep early exit as a producer failure under pipefail.
