---
id: p00002
title: "p00002 — multi-framework router layer: Laravel / Symfony / Express / FastAPI / Django"
kind: feat
status: ready
type: proposal
track: postman-exporter
date: 2026-07-31
related:
    - p00001 # finish v0.1 first (this proposal builds on it)
    - plugins/postman-exporter/
---

# p00002 — multi-framework router layer

## Goal

Decouple the package from "Laravel routes only" by extracting a
router-agnostic core and shipping one adapter per framework:

| Adapter | Source format | Detection signal |
| --- | --- | --- |
| `LaravelRouteParser` | `routes/*.php` with `Route::*()` | `composer.json` + `artisan` |
| `SymfonyRouteParser` | `config/routes.yaml` or `routes.xml` | `composer.json` + `symfony/framework-bundle` |
| `ExpressRouteParser` | `app.use(...)` / `app.get(...)` calls | `package.json` with `express` dep |
| `FastAPIParser` | `@app.get("/path")` decorators | `requirements.txt` + `fastapi` |
| `DjangoParser` | `urlpatterns` in `urls.py` | `manage.py` + `django` |

The router-agnostic core stays unchanged: every adapter returns the
**same** `EndpointSpec[]` shape, so `collection-builder`,
`catalog-enricher`, `environment-builder`, etc. never know which
framework the user is on.

## why

Right now ~600 lines of `route-parser.service.ts` and ~400 lines of
`endpoint-discovery.service.ts` know specifically about Laravel
controllers, action-string format, and `FormRequest` reflection. To
support another framework we'd have to either:

1. Duplicate the whole pipeline (one parser per framework, with its own
   FormRequest equivalent → its own `form-request-parser`).
2. Refactor into a router layer that the agnostic core consumes.

(2) is the same work as (1) for the FIRST framework, but free
thereafter. We're shipping 5 frameworks now so the curve crosses at
adapter #2.

## non-goals

- Per-framework `SchemaParser` (FormRequest equivalent). The Laravel
  one stays the only inline-schema source; other frameworks fall back
  to the agnostic `param-inferrer` (heuristic bodies/queries). That's
  enough for v0.2; per-framework schemas live in a future proposal.
- Schema introspection from OpenAPI/Swagger specs. Same rationale.
- New framework-specific quirks (e.g. Symfony's `_locale` prefix,
  Express's nested routers, FastAPI's `Depends()` injection). Those
  are explicit follow-ups once the core is shipped.

## design

### Core types (new file `contract/router.interface.ts`)

```ts
export interface IRouterAdapter {
  readonly framework: 'laravel' | 'symfony' | 'express' | 'fastapi' | 'django';
  /** True when this adapter is a confident match for the project host. */
  readonly detect: (ctx: IProjectContext) => boolean;
  /** Discover endpoints + (optional) form-request binding. */
  readonly discover: (ctx: IProjectContext) => Promise<IRouteParseResult>;
}

export interface IRouteParseResult {
  routes: ReadonlyArray<DiscoveredRoute>;
  /** Optional mapping method+uri → FormRequest relative path. */
  formRequestByRoute: ReadonlyMap<string, string>;
  /** Adapter-specific annotations (consumed by `param-inferrer` etc.). */
  meta?: Readonly<Record<string, unknown>>;
}
```

### Auto-detection

`endpoint-discovery.service.ts` becomes:

```ts
const adapters = [
  new LaravelRouteParser(),
  new SymfonyRouteParser(),
  new ExpressRouteParser(),
  new FastAPIParser(),
  new DjangoParser(),
];
const adapter = adapters.find((a) => a.detect(projectContext));
if (!adapter) throw new Error(`no router adapter for ${projectRoot}`);
return adapter.discover(projectContext);
```

`detect()` is cheap (one file existence + one regex on
`composer.json` / `package.json` / `requirements.txt`). The first
adapter that matches wins; ties broken by `framework` order (laravel
first).

## slices

### S1 — extract the IRouterAdapter contract + dispatch skeleton
- **Status**: ready
- **Files**: <see slice body below>
- **Gate**: test
  acceptance:

- **Files**: `contract/router.interface.ts` (new),
  `service/router-dispatcher.service.ts` (new),
  `service/endpoint-discovery.service.ts` (refactor to call dispatcher).
- The dispatcher exposes a single public function
  `discoverEndpoints(config, manual)` that runs the same flow as today
  but delegates parsing to the selected adapter.
- **Acceptance**:
  - `bun test tests/unit/router-dispatcher.spec.ts` (new) — 5 cases, one
    per adapter, each asserting the right framework was picked based on
    the project-context fixture.
  - `bun run check` against the existing 3 Laravel workspaces is
    unchanged (269/275/396 requests as today).

### S2 — LaravelRouteParser adapter (the existing parser, repackaged)
- **Status**: ready
- **Files**: <see slice body below>
- **Gate**: test
  acceptance:

- **Files**: `service/router-adapters/laravel.parser.ts` (new,
  extracted from the existing `service/route-parser.service.ts`).
- `service/route-parser.service.ts` becomes a thin facade that
  delegates to the new adapter (back-compat for any direct callers).
- **Acceptance**:
  - `bun test tests/unit/router-adapters/laravel.parser.spec.ts` (new).
  - No behaviour regression on the 3 Laravel workspaces.

### S3 — SymfonyRouteParser adapter
- **Status**: ready
- **Files**: <see slice body below>
- **Gate**: test
  acceptance:

- **Files**: `service/router-adapters/symfony.parser.ts` (new).
- Parses `config/routes.yaml` (Yaml) or `config/routes.xml` (Xml) into
  `DiscoveredRoute[]`. Only handles `path:` + `controller:` + `methods:`
  for now; the annotation-based routing (`#[Route('/api/users')]`)
  is tracked in p00003 follow-up.
- **Acceptance**:
  - 3 fixtures under `tests/fixtures/symfony/` (yaml routes,
    xml routes, mixed) parsed to the expected endpoint count.

### S4 — ExpressRouteParser adapter
- **Status**: ready
- **Files**: <see slice body below>
- **Gate**: test
  acceptance:

- **Files**: `service/router-adapters/express.parser.ts` (new).
- Reads `app.use(...)` / `app.get(...)` / `router.METHOD(path, ...)`
  calls; follows `app.use(prefix, router)` chaining.
- **Acceptance**: 3 fixtures (flat routes, nested routers, prefix
  chaining) parse to the expected endpoint count.

### S5 — FastAPIParser adapter
- **Status**: ready
- **Files**: <see slice body below>
- **Gate**: test
  acceptance:

- **Files**: `service/router-adapters/fastapi.parser.ts` (new).
- Reads `@app.get("/path")` / `@router.post("/x", ...)` decorators from
  every `.py` file in the host.
- **Acceptance**: 2 fixtures (single router, multi-router) parse to
  the expected endpoint count.

### S6 — DjangoParser adapter
- **Status**: ready
- **Files**: <see slice body below>
- **Gate**: test
  acceptance:

- **Files**: `service/router-adapters/django.parser.ts` (new).
- Reads `urlpatterns` from `urls.py` files; follows `include('app.urls')`
  chaining.
- **Acceptance**: 2 fixtures (flat urls, include chain) parse to the
  expected endpoint count.

## Notes

- The plugin tools in `plugins/postman-exporter/` don't need any
  changes — they consume `EndpointSpec[]` regardless of the framework.
- The CLI gains `--list-frameworks` (read-only diagnostic) that prints
  which adapter would be picked for the current `--project-root`.
- Each adapter MUST be hermetic: no network, no `process.cwd()`, no
  `process.env`. The dispatcher injects the `IProjectContext` once.

## acceptance

Every slice lands with its acceptance bullets green. After S6 lands:

- `bun run check` against a representative project for each framework
  works (we'll add Symfony/Express/FastAPI/Django projects to the
  CI matrix; the Laravel ones stay for the per-framework smoke test).
- `bun run --list-frameworks` on each project prints the right
  adapter name.
