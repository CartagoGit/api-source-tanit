---
id: x00062
title: "Fix core → frameworks architectural regression — LanguageIR primitives belong in core"
kind: refactor
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - a00016
  - a00018
---

# x00062 — LanguageIR primitives belong in `core/language-ir`, not in `frameworks/typescript`

## Goal

Reverse the boundary regression introduced when
[`packages/core/language-frontends/typescript/index.ts`](../../../packages/core/language-frontends/typescript/index.ts#L24-L25)
started importing from `packages/frameworks/typescript/`:

```ts
import { buildLanguageIRFromProgram } from "../../../frameworks/typescript/build-language-ir.helper.js";
import { propagateConstants } from "../../../frameworks/typescript/constant-propagation.helper.js";
```

The dependency graph was:

```
contracts
   ↓
core
   ↓
frameworks
```

The new file makes it:

```
core ─────→ frameworks
 ↑             │
 └─────────────┘
```

That violates the project's boundary invariant (`lint:boundaries`
enforces "core must never import from frameworks") and would
silently grow as more adapters land.

## Why (audit 2026-09-06 second pass §16 — P1 architectural)

- `buildLanguageIRFromProgram`, `propagateConstants`,
  `collectMethodCalls`, `collectConstants`, `symbolResolver`,
  `scannerBridge` are **language-level primitives**. They operate on
  Babel AST nodes and the LanguageIR shape. They have no framework
  coupling (no Express/Fastify/Hono knowledge).
- Their consumers are:
  - The Express scanner (which imports `extractRoutes` via the barrel).
  - The Fastify and Hono scanners (via `r00018`).
  - The TypeScript frontend tests (`tests/frameworks/build-language-ir.spec.ts`).
- All of these can equally consume from `core/language-ir/`. The
  current placement in `frameworks/typescript/` is purely historical.

## Approach

### S1 — Move the 5 primitives into `core/language-ir/`

**Files to move**:

| From (legacy) | To |
| --- | --- |
| `packages/frameworks/typescript/build-language-ir.helper.ts` | `packages/core/language-ir/build-language-ir.helper.ts` |
| `packages/frameworks/typescript/constant-propagation.helper.ts` | `packages/core/language-ir/constant-propagation.helper.ts` |
| `packages/frameworks/typescript/collect-method-calls.helper.ts` | `packages/core/language-ir/collect-method-calls.helper.ts` |
| `packages/frameworks/typescript/collect-constants.helper.ts` | `packages/core/language-ir/collect-constants.helper.ts` |
| `packages/frameworks/typescript/symbol-resolver.helper.ts` | `packages/core/language-ir/symbol-resolver.helper.ts` |
| `packages/frameworks/typescript/scanner-bridge.helper.ts` | `packages/core/language-ir/scanner-bridge.helper.ts` |
| `packages/frameworks/typescript/tagged-template.helper.ts` | `packages/core/language-ir/tagged-template.helper.ts` |

**Files to update imports in**:

- `packages/core/language-frontends/typescript/index.ts` — change the
  two `frameworks/typescript/...` imports to `core/language-ir/...`.
- `packages/frameworks/scanners/express.scanner.ts` and the rest of
  the scanners that consume these helpers directly (grep +
  `replace_string_in_file` for each path).
- `tests/frameworks/build-language-ir.spec.ts` and the other
  `frameworks`-suffixed tests for the moved files — same grep +
  replace.
- `packages/frameworks/typescript/` becomes a barrel file
  (`packages/frameworks/typescript/index.ts`) that re-exports from
  `core/language-ir/` for legacy consumers (1-line `export * from`).
  This barrel can be deleted in a future slice once nothing imports
  from `frameworks/typescript` anymore.

**Gate**:

- `bun run typecheck` green.
- `bun run test:core` green (the tests move with the files).
- `bun run test:frameworks` green.
- `bun run lint:boundaries` green (the new helper no longer crosses
  the boundary).
- `bun run validate:examples` green (no behaviour change).

### S2 — Delete the legacy barrel once empty

After S1, grep for `from ".*frameworks/typescript/` in non-test code:

- If 0 hits: delete `packages/frameworks/typescript/index.ts` and the
  empty directory. Add `lint:frameworks-cleanup` if useful.
- If hits remain: keep the barrel, file a follow-up to migrate the
  consumer (the barrel is no longer a regression, it's a deprecation
  bridge).

**Gate**: `bun run typecheck` green; `bun run lint` green.

## Acceptance

- `packages/core/` no longer imports from `packages/frameworks/`. The
  gate enforces this; this proposal is the surgical fix.
- `bun run lint:boundaries` stays green.
- `bun run validate` is green (typecheck + lint + tests + drift guards).
- A new scanner that wants to consume LanguageIR primitives imports
  from `core/language-ir/` without crossing any boundary.

## Risks

- **Test churn**: ~30 import paths in 5-10 files need updating.
  Mitigation: `replace_string_in_file` is mechanical and the lint
  catches any miss.
- **Circular dep risk**: if `core/language-ir/` accidentally imports
  anything from `contracts/interfaces/core/language/...` while the
  scanner still imports a contract that re-exports from `core/`,
  the cycle shows up at typecheck. The existing barrel already proves
  the direction is safe.
- **Loss of git blame**: the moved files lose their history. Mitigation:
  use `git mv` to preserve history; or document the move in
  `CHANGELOG.md` if the project requires it.

## Out of scope

- A wider "core → frameworks" boundary audit (similar regressions
  may exist for other languages, e.g. Python AST primitives in
  `frameworks/python/`). Tracked as a follow-up if discovered.