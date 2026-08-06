---
id: p00007
title: "p00007 — publish @mcp-vertex/core to npm and switch plugins to it"
kind: feat
status: ready
type: proposal
track: postman-exporter
date: 2026-07-31
related:
    - d692f50 # plugins commit
    - p00004 # resolves dependabot noise once we stop using file: protocol
---

# p00007 — publish @mcp-vertex/core to npm

## Goal

The local `file:../../../mcp-vertex/packages/core` resolution in
the plugin `package.json` files is a development-only workaround. As
soon as the host project publishes its first stable version of
`@mcp-vertex/core` on npm, we switch both plugins to consume the
published version.

This proposal is **declarative** — it's the dependency direction we
need to migrate to, but the actual `bun pm publish` step belongs to
the **mcp-vertex** repo, not here. Tracking it here means we don't
have to re-discuss the migration when the host publishes.

## why

- `file:` deps break `npm publish` (the tarball embeds the
  monorepo source).
- `file:` deps break `bun install` on a CI machine that doesn't have
  the host repo at the relative path.
- `file:` deps propagate the host's transitive deps into the package's
  dependabot tree (this is the root cause of p00004).

A simple `@mcp-vertex/core: "^0.1.0"` in each plugin's
`package.json` makes our package reproducible, CI-clean, and
dependabot-clean.

## non-goals

- Driving the actual publish. This proposal only covers the
  consumption switch.
- Picking a semver for the host. The host repo owns the version.
- Coordinating with the host's release schedule. We accept whatever
  version they ship.

## slices

### S1 — switch to `^0.1.0` once `npm view @mcp-vertex/core` succeeds
- **Status**: ready
- **Files**: `plugins/postman-exporter/package.json`,
  `plugins/postman-exporter-testing/package.json`,
  `plugins/postman-exporter/README.md`,
  `plugins/postman-exporter-testing/README.md`.
- **Gate**: clean install on a fresh checkout.

- Replace `"@mcp-vertex/core": "file:../../../mcp-vertex/packages/core"`
  in both plugins with `"@mcp-vertex/core": "^0.1.0"`.
- Update the "Development vs published" section in each plugin
  README to point at the npm registry.
- **Acceptance**:
  - `bun install` from a fresh checkout (no `../mcp-vertex` in
    `..`) succeeds.
  - `npm publish --dry-run` shows the consumed version.

## acceptance

A fresh checkout of `postman-exporter` clones without the
`mcp-vertex` repo as a sibling, `bun install` succeeds, and the
plugins resolve `@mcp-vertex/core` from the npm registry.
