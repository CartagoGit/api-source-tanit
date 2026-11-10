---
id: x00100
title: "Parse legacy Laravel resource and match routes"
kind: fix
status: in-progress
type: proposal
track: general
date: 2026-11-10
last-transition-id: 5fe5acaf-4a71-4494-b608-4cce9fdc97d4
last-correlation-id: 5fe5acaf-4a71-4494-b608-4cce9fdc97d4
last-transition-from: ready
last-transition-at: 2026-11-10T18:37:42.559Z
---

# x00100 — Parse legacy Laravel resource and match routes

## goal

Discover the method/path pairs declared by legacy Laravel `Route::match`
and `Route::resource` calls so the scanner matches the framework's actual
route table.

## why

The pinned Laravel RealWorld API uses string controller actions and the
third-argument `only` / `except` resource options. The scanner currently
supports modern `::class` resources but omits these legacy declarations,
which leaves 11 of the 21 reviewed route pairs undiscovered in the acceptance
corpus.

## non-goals

- Do not alter the external corpus oracle or the T5 runner.
- Do not change modern `Route::resource` / `Route::apiResource` parsing.
- Do not infer response or schema expectations beyond the reviewed corpus.

## slices

- global_gate: none

### S1 — Parse legacy resource and match declarations
- **Status**: pending
- **Files**: `packages/frameworks/laravel/laravel.scanner.ts`, `tests/frameworks/laravel-scanner.spec.ts`, this proposal.
- **Gate**: targeted Laravel scanner spec.
- **Acceptance**: legacy `Route::match(['put', 'patch'], ...)` emits both declared methods; legacy `Route::resource` honors its third-argument `only` / `except` options and nested resource paths; existing modern resource tests still pass.

## acceptance

- The legacy Laravel sample route declarations produce all 21 manually reviewed method/path pairs, including both verbs from `Route::match`, the `articles` resource with `except: create, edit`, and the nested comments resource with `only: index, store, destroy`.
- The active Laravel scanner's targeted test suite passes, including existing modern `resource` and `apiResource` regressions.
- The response oracle remains limited to the already reviewed claims.
