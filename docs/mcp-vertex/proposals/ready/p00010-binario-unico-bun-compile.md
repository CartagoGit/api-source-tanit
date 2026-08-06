---
id: p00010
title: "p00010 — single-binary distribution via `bun build --compile`"
kind: feat
status: ready
type: proposal
track: postman-exporter
date: 2026-07-31
related:
    - p00008 # npm path
    - p00007 # the plugin's runtime dep
---

# p00010 — single-binary distribution via `bun build --compile`

## Goal

Ship a self-contained `postman-from-routes` binary for the three
target platforms (linux-x64, darwin-x64, darwin-arm64, windows-x64) so
a user can run:

```bash
# No bun, no node, no clone.
curl -L https://github.com/CartagoGit/postman-exporter/releases/latest/download/postman-from-routes-linux-x64 -o /usr/local/bin/postman-from-routes
chmod +x /usr/local/bin/postman-from-routes
postman-from-routes generate --project-root $(pwd)
```

without installing Bun or Node themselves.

## why

Pubishing the npm package (p00008) is the recommended path for
projects that already have Bun/Node. But the target audience for
postman-exporter is **mixed-language Laravel teams** where some
members don't have a JS runtime installed. Asking them to install
Bun is friction.

A single binary per platform closes the gap: a teammate with no JS
runtime can run `postman-from-routes generate` from PHPStorm's
external terminal.

## non-goals

- Cross-compilation with `zig cc` or `pkg`. Bun's built-in
  cross-compile is enough.
- Code signing / notarisation. The binary is an unsigned artefact for
  v0.1; v0.2 can add it.
- Auto-update. The release workflow is enough for v0.1.

## slices

### S1 — `bun build --compile` for the 4 platforms
- **Status**: ready
- **Files**: `.github/workflows/build-binary.yml` (new),
  `scripts/build-binary.script.ts` (new).
- **Gate**: `gh release list` shows binaries attached.

- `scripts/build-binary.script.ts` runs:
  ```bash
  bun build --compile --target=bun-linux-x64 \
      --outfile=dist/postman-from-routes-linux-x64 \
      scripts/cli.script.ts
  ```
  for each platform.
- `.github/workflows/build-binary.yml` runs on a tag push:
  ```yaml
  on: { push: { tags: ['v*'] } }
  ```
  - `bun run build:binary` from `scripts/build-binary.script.ts`
  - Upload artefacts to the GitHub release.
- **Acceptance**:
  - The CI workflow runs on a `v0.1.0` tag push.
  - The release page lists 4 binaries.

### S2 — check the runtime size is reasonable
- **Status**: ready
- **Files**: `scripts/build-binary.script.ts`.
- **Gate**: each binary is <120 MB.

- `bun build --compile --minify` (`--minify` is on by default in Bun
  1.1+; verify in the script).
- If a binary is >120 MB, document the size in the README and
  consider `bun build --compile --external <dep>` to shrink.
- **Acceptance**:
  - `du -h dist/postman-from-routes-*` shows each binary <120 MB.

## acceptance

A download from the GitHub release page gives the user a runnable
binary that doesn't require Bun or Node. The size is documented.
A user can run `postman-from-routes --help` and see the CLI.
