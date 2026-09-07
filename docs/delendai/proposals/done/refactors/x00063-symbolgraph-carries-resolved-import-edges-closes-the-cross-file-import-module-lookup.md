---
id: x00063
title: "SymbolGraph carries resolved import edges — closes the cross-file `import → module` lookup"
kind: refactor
status: done
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - r00014
shippedIn:
  - 181b55a
last-transition-id: batch-close-2026-09-07
last-transition-from: ready
---

# x00063 — `IImportEdge` carries the resolved target file; `SymbolGraph` no longer searches globally

## Goal

Today
[`SymbolGraph.resolveByImportPath()`](../../packages/core/discovery/symbol-graph.ts#L172-L195)
takes `(sourceFile, specifier, localName)` and returns:

```ts
for (const [targetFile, bucket] of state.byFile.entries()) {
  if (targetFile === sourceFile) continue;
  for (const n of bucket) {
    if (n.id.localName === matching.importedName) out.push(n);
  }
}
```

i.e. it scans **every other file** for a symbol with the right
`localName`. In a project with two routers named `router` in two files,
the Express scanner gets BOTH candidates and has to disambiguate by
hand (and `x00055` S3 did exactly that).

## Why (audit 2026-09-06 §4 P1 architectural)

- The product already has a dedicated cross-file import resolver
  (`packages/core/discovery/import-resolver.ts` — added in `r00014`).
- The SymbolGraph should consume its output, not re-derive it.
- The audit's P1 was specifically "an `IImportEdge` with
  `resolvedTargetFile` closes the ambiguity gap". Express already
  uses its own resolver; the SymbolGraph generic should too.

## Approach

### S1 — Extend the data shape

**Files**:

- `packages/contracts/interfaces/core/symbol-graph.interface.ts` — add:

  ```ts
  export interface IImportEdge {
    readonly sourceFile: string;
    readonly specifier: string;
    readonly localName: string;
    readonly importedName: string;
    /** Resolved by `ImportResolver`. `null` if unresolvable (e.g.
     *  a package outside the project; `node_modules`). */
    readonly targetFile: string | null;
    /** The SymbolId at `targetFile` if the resolver mapped the
     *  binding all the way to a concrete node. */
    readonly targetSymbol: string | null;
  }
  ```

- Keep the existing `IImportRecord` for backwards compatibility (a
  thin alias `type IImportRecord = IImportEdge` with the two new
  fields optional).

**Gate**: `bun run typecheck` green.

### S2 — SymbolGraph consumes the resolver

**Files**:

- `packages/core/discovery/symbol-graph.ts` — change the
  `addImport(record)` path so it accepts an `IImportEdge` and stores
  the resolved `targetFile` / `targetSymbol`.
- `resolveByImportPath()` becomes:

  ```ts
  resolveByImportPath(sourceFile, specifier, localName): readonly ISymbolNode[] {
    const edge = imports.find(...)
    if (!edge) return [];
    if (edge.targetSymbol) {
      // Direct lookup — exact match, no search.
      return [ nodesById.get(edge.targetSymbol)! ];
    }
    if (edge.targetFile) {
      // Narrowed search: only the resolved file.
      const bucket = state.byFile.get(edge.targetFile) ?? [];
      return bucket.filter(n => n.id.localName === edge.importedName);
    }
    // Unresolved: legacy behaviour (scan all files). Warn in dev.
    …
  }
  ```
- `packages/core/discovery/import-resolver.ts` — when invoked, pass
  the resolved `targetFile` (it already does most of the work).

**Gate**: `bun run test:core` green; existing `tests/core/
symbol-graph*.spec.ts` pass; `x00055` E2E tests pass (the express
multi-router fixture must still find the right router per import).

## Acceptance

- `SymbolGraph.resolveByImportPath("app.ts", "./users/router", "router")`
  returns ONLY the `router` symbol declared in `users/router.ts`.
- The legacy "scan-all-files" fallback is reached only when the
  resolver returns `targetFile: null` (i.e. truly unresolvable).
- `bun run test:core` and `bun run test:e2e` stay green.
- The Express scanner's private `resolveRouterImport` (added in
  `x00055`) can be simplified to delegate to `SymbolGraph`.

## Risks

- The Express scanner's resolver has subtle heuristics (suffix `.ts/
  .tsx/.js/.jsx/index.*`) that the generic SymbolGraph path may not
  replicate. Mitigation: the resolver lives in `import-resolver.ts`
  which both paths consume; the heuristics are shared.

## Out of scope

- Cross-file TS type resolution. Tracked as the larger
  "Universal Language IR" roadmap (a00018 §1).