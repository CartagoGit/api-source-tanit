---
id: x00069
title: "Intel Mac (darwin-x64) single-binary launcher"
kind: chore
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - a00018
---

# x00069 — `darwin-x64` binary ships from CI (Intel Mac users can run the launcher)

## Goal

Today the POSIX launcher in
[`bin/wrappers/apisrc.php`](../../../bin/wrappers/) / the equivalent
JS / Python wrapper detects:

- `darwin + x86_64` → download `apisrc-darwin-x64`

But the build script (`scripts/build/build-binary.script.ts`) only
produces:

- `linux-x64`
- `linux-arm64`
- `darwin-arm64`
- `windows-x64.exe`

So an Intel Mac user gets a 404. The audit's recommendation is either
ship `darwin-x64` or explicitly mark Intel Mac unsupported.

## Why (audit 2026-09-06 §14 — P2)

- Tanit explicitly supports macOS in `docs/DESKTOP-INSTALL.md` (Intel
  + Apple Silicon). The launcher contradicts that.
- Bun still supports `darwin-x64`. The build is one line in the
  workflow.

## Slices

### S1 — Add `darwin-x64` to the build matrix

**Files**:

- `scripts/build/build-binary.script.ts` — add `darwin-x64` to the
  target list.
- `.github/workflows/release.yml` — add the build job (same shape as
  the existing `darwin-arm64` job).
- `bin/wrappers/apisrc.php` / `bin/apisrc` — confirm the URL pattern
  matches what the workflow publishes (already does).

**Gate**: a release build on a dry-run PR publishes the
`apisrc-darwin-x64` artefact; the launcher's
`curl -fsSL …/darwin-x64` no longer 404s on a Mac.

### S2 — Test on Intel Mac CI

**Files**:

- `.github/workflows/validate-binary.yml` (or equivalent) — add an
  Intel Mac runner job that downloads the artefact, runs
  `apisrc --version`, asserts success.

**Gate**: the new job is green on the test PR.

## Acceptance

- An Intel Mac user running `curl -fsSL <install-script> | bash`
  installs a working binary (no 404).
- The build matrix in the release workflow includes `darwin-x64`.

## Risks

- Bun may stop supporting `darwin-x64` in the future. Mitigation: the
  CI matrix validates each release; if Bun drops the target, the CI
  catches it.
- Larger release artefact size (~20-30 MB extra). Acceptable.

## Out of scope

- A "skip Intel Mac" policy. The proposal keeps the support; a
  separate proposal can deprecate it if Bun's roadmap makes it
  impractical.