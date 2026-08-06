---
id: p00011
title: "p00011 — lint rule: no `process.cwd()` / `process.env` in plugin tools"
kind: feat
status: done
type: proposal
track: postman-exporter
date: 2026-07-31
related:
    - p00006 # the extension contract documents this rule
    - p00005 # the agents must obey the rule
---

> **Cerrada 2026-08-06.** Implementado en `bun run lint:tools`, encadenado dentro de `bun run validate` (p00018 S1).

# p00011 — lint rule: no `process.cwd()` / `process.env` in plugin tools

## Goal

Add a custom vitest plugin (or a `bun --bun run` script) that scans
`plugins/**/src/lib/tools/**/*.ts` and fails the build if any
`tool.ts` module:

- References `process.cwd()`.
- References `process.env.<X>` directly (without going through an
  `IXxxOptions` Zod schema).
- Hardcodes a path string that starts with `/` or `~`.

The rule is checked in CI (`bun run lint:tools`) and runs in <500 ms.

## why

The plugin's contract is "single source of truth in `IMcpPluginContext`".
A tool that reaches out to `process.cwd()` or `process.env` breaks
that contract — it makes the plugin:

- **Untestable** (no way to inject a working dir).
- **Unportable** (production may have a different `cwd` than dev).
- **Insecure** (a tool that reads `process.env.SECRET` is a primitives-leak).

The `runner.helper.ts` plus the `IMcpPluginContext.workspace` already
cover every legitimate need. The lint rule encodes the
"don't do this" decision in machine-checkable form.

## non-goals

- Replacing the lint with a Typescript ESLint plugin. The builtin
  Bun test runner + a custom check is enough for v0.1.
- A lint rule for the **service** layer. Services are allowed to
  read `process.env` (e.g. `POSTMAN_PROJECT_ROOT` is a documented
  fallback). Only `plugins/**/src/lib/tools/**` is locked.
- A lint rule for the contract/helpers. Helper contracts are the
  boundary; tools are the public surface.

## slices

### S1 — `scripts/lint-tool-no-process.script.ts`
- **Status**: ready
- **Files**: `scripts/lint-tool-no-process.script.ts` (new),
  `package.json` (add `lint:tools` script).
- **Gate**: `bun run lint:tools` exits 0 on the current
  `plugins/postman-exporter/src/lib/tools/`.

- The script uses `Bun.Glob` to enumerate `plugins/**/src/lib/tools/*.ts`.
- For each file, it tokenises the source with a regex that looks
  for `process.cwd()`, `process.env.<X>`, and path-shaped strings.
- On any hit, it prints the offending line + the file path and
  exits 1.
- **Acceptance**:
  - `bun run lint:tools` is green on the current state.
  - Adding a `console.log(process.cwd())` to a tool makes the
    script fail with a clear line:filepath hint.

### S2 — wire into the existing `bun run check` chain
- **Status**: ready
- **Files**: `package.json` (modify the `check` script).
- **Gate**: `bun run check` runs `lint:tools` first.

- Add `bun run lint:tools` to the `check` script chain.
- **Acceptance**:
  - `bun run check` exits 0 + green on the current state.
  - When a developer pushes a tool with `process.cwd()`, CI
    red-flags the PR.

## acceptance

- `bun run lint:tools` is a documented gate.
- All 4 current tools (`generate`, `validate`, `summary`, `test`)
  pass the rule.
- The contract doc (p00006) cross-references the rule.
