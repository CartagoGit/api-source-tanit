---
id: x00127
title: "Preserve signature membership checks under pipefail"
kind: fix
status: in-progress
type: proposal
track: release
date: 2026-11-21
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
- **Status**: pending
- **Files**: `scripts/release/verify-signature.sh`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: type
- acceptance:
  - "Manifest membership remains exact whole-line matching."
  - "The verifier no longer treats grep early exit as a producer failure under pipefail."

## acceptance

- Manifest membership remains exact whole-line matching.
- The verifier no longer treats grep early exit as a producer failure under pipefail.
