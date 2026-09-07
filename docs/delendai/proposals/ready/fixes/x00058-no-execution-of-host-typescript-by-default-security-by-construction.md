---
id: x00058
title: "No execution of host TypeScript config by default — security by construction"
kind: fix
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - a00018
---

# x00058 — `loadProject()` must NOT execute host TypeScript by default

## Goal

Stop Tanit from executing arbitrary TypeScript/JavaScript code that lives
inside the project it is analysing. Today
[`project-loader.service.ts`](../../../packages/core/discovery/project-loader.service.ts)
loads `config.constant.ts` and `endpoints.constant.ts` via:

```ts
const mod = await import(`${url}?t=${Date.now()}`);
```

That means a developer pointing Tanit at **any** repo that contains a
`config.constant.ts` (Laravel convention: `resources/postman/examples/<project>/config.constant.ts`)
hands Tanit the ability to `require()` arbitrary code in the same Node
process. For Tanit-as-a-CLI-on-your-own-repo this is acceptable; for Tanit
embedded in MCP, the web UI, the desktop shell, or any agent/CI run against
a third-party repo, it is a security boundary violation.

## Why (audit 2026-09-06 §1 — P0/P1)

- The audit flagged this as **P1** for "developer uses Tanit on own repo".
- For Tanit-as-engine-for-agents (MCP, web UI, CI, third-party repos), the
  same code path is **P0**: a malicious `config.constant.ts` runs as part
  of the analysis. Worst case: writes files into the host FS via
  `outputDir` (cf. the UI server incident the audit cites).
- Tanit's own docs (`docs/INSTALL.md`, `docs/MCP-SURFACE.md`) increasingly
  describe Tanit as something an agent runs against unfamiliar code. The
  threat model changed; the loader did not.

## Approach

Replace `import(url)` with **AST-only parsing** of the host's `.ts` file.
The two supported sources are:

1. **`config.constant.ts`** — extract `export const config = { … }` via a
   tiny Babel visitor that walks `ExportNamedDeclaration` →
   `VariableDeclaration` → `Identifier("config")` and reads the literal
   object tree. No execution. No function calls evaluated.
2. **`endpoints.constant.ts`** — same approach for
   `export const ALL_ENDPOINTS = [ … ]`.

Behaviour preserved:

- All current shape keys (`baseUrl`, `collectionName`, `variables`,
  `filePrefixes`, …) are read.
- Schema-level validation (same Zod schema used by the JSON variant).
- Unknown keys are passed through to `ProjectConfig` like today.
- Loader errors surface the path and line of the unparseable file with a
  precise message — same DX as `import()` but no execution.

Opt-in **escape hatch** for users that genuinely need executable configs
(legacy Laravel projects with computed `baseUrl`, etc.):

```ts
// loadProject() opts:
{
  allowConfigExecution: boolean;  // default false
}
```

Surfaced to CLI as `--allow-config-execution` and to the MCP plugin as
`IProjectContext.allowConfigExecution` (default false everywhere; the
opt-in is explicit and documented in `docs/SECURITY.md`).

The `importTsModule()` helper stays in the codebase behind the
`allowConfigExecution` gate. When the gate is closed, it is unreachable
from any caller that comes through `loadProject()`.

### What stays unchanged

- `buildZeroConfig()` already doesn't import anything. Untouched.
- `POSTMAN_CONFIG` and `--config <path>` flow through the same path; the
  AST parser is reached either way.
- `endpoints.constant.ts` discovery (`dir/*.constant.ts` candidates) is
  preserved.

## Slices

### S1 — `extractConfigFromSource` AST parser (core, isolated)

**Files**:

- `packages/core/discovery/host-config-parser.ts` (new)
- `packages/core/discovery/host-config-parser.spec.ts` (new, ≥10 tests)

**Tests**:

1. Extracts `export const config = { … }` from a minimal TS file.
2. Extracts `export default { … }` (fallback).
3. Extracts `export const projectConfig = { … }` (third alias).
4. Surfaces line/column for a syntax error.
5. Refuses to evaluate `require("fs")` — present in the file is fine, but
   the parser never calls it.
6. Refuses to evaluate `function` declarations (preserves them as
   `_excluded: true` markers so callers can warn).
7. Accepts nested objects, arrays, primitives, template literals without
   expressions.
8. Surfaces "no `config` export found" with the file path.
9. Round-trips a real `examples/example-app/config.constant.ts` (used in
   tests today via `import()`).
10. Performance: parses the example config in <50 ms (no Babel full build,
    only the parts we touch).

**Gate**: `bun run test:core` green; `bun run typecheck` green.

### S2 — `loadProject()` consumes the AST parser

**Files**:

- `packages/core/discovery/project-loader.service.ts` — replace
  `importTsModule()` calls with `extractConfigFromSource()` reads.
- `tests/core/project-loader.branches.spec.ts` — verify the new behaviour;
  add 4 tests for "AST parser refuses to execute function bodies".
- `tests/core/process-argv-free.spec.ts` — verify the `allowConfigExecution`
  flag still wires through (it has to, for the legacy escape hatch).

**Gate**: `bun run test:core` green; `bun run test:e2e` green (the
Laravel example loads its real `config.constant.ts` and must keep
producing the same collection).

### S3 — Escape hatch + docs

**Files**:

- `packages/cli/commands/generate.script.ts` — add `--allow-config-execution`
  flag (defaults off). Print `⚠ Executing host config — security risk`
  in red when enabled.
- `packages/contracts/interfaces/core/project-context.interface.ts` —
  add `allowConfigExecution?: boolean` (default false).
- `docs/SECURITY.md` (new) — document the model: "Tanit parses your
  config. It does NOT execute it. The only exception is the explicit
  `--allow-config-execution` flag, which is documented in
  `docs/INSTALL.md#security`."

**Gate**: `bun run lint` green; `bun run validate:examples` green.

## Acceptance

- `loadProject()` does not call `import()` for any file inside the host
  project. Static proof: `grep -rn "import(" packages/core/discovery/
  project-loader.service.ts` returns no calls except the gated escape
  hatch.
- The 21 examples (`bun run validate:examples`) keep producing the same
  collections (or surface a precise error if their `config.constant.ts`
  uses features the parser does not support yet — that case is a
  documented migration).
- A test fixture `tests/fixtures/malicious-config/` containing a
  `config.constant.ts` with `require("fs").writeFileSync("/tmp/pwn",
  "owned")` is loaded successfully **without the marker file being
  written**. The test asserts `/tmp/pwn` does not exist after the load.
- `bun run lint:process-env` stays green (we removed one
  `process.env.POSTMAN_CONFIG` indirect path through `import()` but the
  flag read itself stays).

## Risks

- **Backwards compatibility**: legacy configs that compute values via
  function calls break. Mitigation: `allowConfigExecution` escape hatch
  + a precise error message pointing at the file/line of the offending
  expression.
- **Parser coverage**: a `config.constant.ts` that uses getters,
  spread operators on dynamic values, or imported constants may not
  parse to the same shape. Mitigation: the parser surfaces
  `unsupportedExpression` diagnostics and the CLI prints them with
  `--show-config-diagnostics`. The 21 examples are well-tested in S2;
  any breakage is logged.
- **Performance**: AST parsing adds ~10-30 ms per config. Mitigated by
  reusing Babel's parser program when called inside a scanner that
  already has one (rare but possible).

## Out of scope

- Executing `endpoints.constant.ts` via `--allow-endpoint-execution`
  (mirrored feature for the manual-override file). It can be added in a
  follow-up; the security risk is the same and the parser change covers
  it.