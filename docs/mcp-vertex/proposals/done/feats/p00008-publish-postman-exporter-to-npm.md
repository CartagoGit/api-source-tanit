---
id: p00008
title: "p00008 — publish @postman-exporter/cli to npm v0.1.0"
kind: feat
status: done
type: proposal
track: postman-exporter
date: 2026-07-31
related:
    - p00001 # finish v0.1 first
    - p00004 # cleanup before publish
    - p00009 # tests before publish
---

> **Cerrada 2026-08-06.** Preparación completa: LICENSE, metadatos npm, `files` con la documentación, y `bun run validate:package` que empaqueta, instala en un proyecto limpio y ejecuta el binario. **El `npm publish` en sí queda para el dueño del repo**: publicar es irreversible y necesita credenciales.

# p00008 — publish @postman-exporter/cli to npm v0.1.0

## Goal

After p00001 (finish v0.1), p00004 (resolve dependabot), and p00009
(tests), publish the package under the npm name
`@postman-exporter/cli` (`name` already in `package.json`).

The publish flow:

1. `bun run validate` (the `all` script) is green on the default branch.
2. `bun pm pack` produces a clean tarball (no `node_modules`, no `bun.lock`,
   no host fixtures).
3. `bun pm publish` to the `public` registry (the `publishConfig.access`
   field is already set).

## why

Right now the package is functional but unpublished. The two
workspace projects (mz-api and mz-lx-api) consume it by running
`bun run scripts/cli.script.ts` directly from a clone. That works
for development but blocks:

- External adoption (a new user shouldn't have to clone the repo).
- CI gating (a CI pipeline that wants to lint the package can't
  `bun install` it).
- The mcp-vertex plugin's `defaultProjectRoot` and `cliScript` paths
  (p00005 references published-version conventions).

## non-goals

- Publishing the **plugin** (`plugins/postman-exporter/`) as a
  separate npm package. That's tracked elsewhere.
- Versioning beyond `0.1.0`. The very first release is the milestone.
- A `bin` alias for `bunx postman-from-routes`. The bin already
  points to `./scripts/cli.script.ts` and Bun handles it directly.

## slices

### S1 — `package.json` sanity for npm
- **Status**: ready
- **Files**: `package.json`, `README.md`.
- **Gate**: `bun pm pack --dry-run` shows only the entry in `files`.

- Confirm `files` only carries `contract/`, `service/`, `helper/`,
  `scripts/`, `tsconfig.json`, `README.md` (it already does).
- Confirm `publishConfig.access: "public"` (it already is).
- `bin` is already `postman-from-routes` → `./scripts/cli.script.ts`.
- Add a minimum README section: "Install via `bun add -d @postman-exporter/cli`"
  and "Run via `bunx postman-from-routes generate`".
- **Acceptance**:
  - `bun pm pack --dry-run` from the root shows the right file list.
  - The `repository` field points at `CartagoGit/postman-exporter`.

### S2 — publish + tag
- **Status**: ready
- **Files**: `CHANGELOG.md` (new), `package.json` (version bump).
- **Gate**: the version is on the npm registry.

- Create `CHANGELOG.md` with the v0.1.0 entry summarising the 4
  commits (170672e, d692f50, dbbcd1d, plus p00001-7 once landed).
- `bun pm publish` (manual, one-time).
- Tag the commit `v0.1.0` and push the tag.
- **Acceptance**:
  - `npm view @postman-exporter/cli versions` shows `0.1.0`.
  - `git tag --list` shows `v0.1.0`.

## acceptance

The package is on npm, installable via `bun add -d @postman-exporter/cli`,
and the tag is in the repo.
