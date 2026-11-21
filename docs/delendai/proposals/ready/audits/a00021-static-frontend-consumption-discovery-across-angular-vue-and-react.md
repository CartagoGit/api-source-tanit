---
id: a00021
title: "Static frontend consumption discovery across Angular, Vue, and React"
kind: audit
status: ready
type: proposal
track: api-source-tanit
date: 2026-11-21
---

# a00021 — Static frontend consumption discovery across Angular, Vue, and React

## goal

Define a reusable static-analysis engine that discovers frontend API consumption, correlates it with server operations, and sequences CLI, application, and exporter integration without claiming complete framework coverage.

## why

Tanit currently discovers API producers: `DiscoveryOrchestrator` selects registered
`IProjectScanner`/`IRouteScanner` implementations and `runScan`/`generateWithAllFrameworks`
turn their routes into operations and exports. It does not answer the reverse question:
which frontend source files call those operations, or which operations have no statically
visible consumer.

The repository already has reusable foundations. `ILanguageFrontend.extractCalls()` and
`ICallExpression` provide language-neutral callee, receiver, method, arguments and source
location. The TypeScript frontend parses JS/TS and enables JSX/TSX; LanguageIR adds aliases,
re-exports, constant propagation and symbol resolution. `ProjectIndex`/`AstCache` provide
the intended single file walk and parse cache. These primitives are currently consumed by
server route scanners, not by a client-usage analysis.

The framework boundary is material: React TSX/JSX is already parseable; `.vue` SFC files
and Angular HTML templates are not AST-capable inputs today. A credible plan therefore
ships a shared static engine first, then framework adapters, with unresolved results made
explicit rather than inferred.

## non-goals

- Runtime/network tracing, browser instrumentation, and test execution.
- A TypeScript type checker, whole-program evaluation, or arbitrary dynamic URL execution.
- Claiming complete Angular, Vue, or React framework coverage in the first slice.
- Inferring generated-client calls without a concrete static call site.
- Changing the existing server route scanners or making export generation depend on client
  analysis before the read-only result is proven.

## slices

- global_gate: none

### S1 — Shared client-consumption contract and engine
- **Status**: pending
- **Files**: `packages/contracts/interfaces/core/client-consumption.interface.ts`,
  `packages/core/discovery/client-consumption.service.ts` (names are planning targets),
  tests/fixtures for JS/TS/JSX/TSX.
- **Gate**: `bun run typecheck && bun run test:core`

Define an `IClientUsage` result with method (when known), URL/path (when statically known),
source file and location, evidence, confidence, and an explicit unresolved reason. Add a
reusable scanner over the existing TypeScript frontend/LanguageIR and ProjectIndex. The
first recognizers are `fetch(url, init)`, `axios.get/post/request`, and configurable
client aliases such as `http.get/post`. Accept literal URLs and conservative constant or
static-template propagation only. Normalize relative paths and correlate known
`(method,path)` pairs with discovered server operations; never discard an unresolved call.

Expected unresolved cases include computed URLs, concatenation with unknown values,
aliases crossing packages, wrapper functions whose implementation is unavailable,
generated SDKs, and framework-specific template syntax. Each must carry a reason rather
than a false match.

### S2 — CLI and MCP read-only surface
- **Status**: pending
- **Files**: `packages/cli/commands/client-usage.script.ts` (planning target),
  `integrations/delendai/src/lib/tools/client-usage.tool.ts` (planning target), contracts
  and command tests.
- **Gate**: `bun run typecheck && bun run test:core`

Expose a dedicated `clients`/`client-usage` read-only command and MCP tool. It should return
the usage records, matched/unmatched operation counts, unresolved reasons, and diagnostics.
Do not alter `generate`, collection files, or persisted project state in this slice. The
CLI and MCP entry points must call the same shared engine and return structured data rather
than parse human output.

### S3 — Framework adapters, application view, and exporter sequencing
- **Status**: pending
- **Files**: adapter and UI/export files to be selected after S1/S2 evidence.
- **Gate**: scoped tests plus `bun run validate`

Sequence adapters after the generic engine: (a) React TSX/JSX call sites, which reuse the
existing parser; (b) Angular TypeScript plus a separate Angular-template extractor; (c)
Vue SFC extraction for `<script>`/`<script setup>` and template bindings. Only after the
read-only result is stable should the Application API expose a client-usage view and an
exporter optionally add consumer metadata. Export output must remain backward compatible
and client analysis must remain optional.

### Pairwise comparison and selection boundary

Pairwise comparison is a read-only phase after S2. It compares an explicitly selected
frontend usage record with an explicitly selected backend operation; it must not choose a
route merely because its path looks similar. The backend selector is a stable operation
id when one exists, otherwise the normalized `(service, method, path)` tuple. A frontend
selector carries source file, location and recognizer. If either selector resolves to
multiple candidates, the result is `ambiguous`, with all candidate ids and the reason;
the engine must not silently pick the first one. Selection by method/path is allowed only
when it yields exactly one backend candidate.

The comparison reports `request` and `response` judgements independently, each as
`compatible`, `incompatible`, or `unknown`, plus an overall judgement and evidence. URL
normalization may reconcile relative paths and conventional path-parameter spellings
(`:id`, `{id}`), but it must retain an evidence note and must not erase a parameter-name
or method mismatch. A selected response status is required when several backend
responses exist; absent that selection, comparison is `unknown` unless one response is
uniquely provable.

The TypeScript-check phase is deliberately separate from static call discovery. It may
use the TypeScript checker against project declarations, but must never execute user
source, import application modules, or evaluate arbitrary URL expressions. The generic
MVP comparator operates only on normalized JSON-schema-like shapes from `EndpointSpec`
(`body`/`schemaGraph`) and inferred responses (`schema-graph`, `ref`, or `empty`). Open
bags, unresolved refs and unsupported schema constructs produce `unknown`, not a guess.

Assignability is directional: a request is safe when the frontend request type is
assignable to the backend accepted type; a response is safe when the backend response
type is assignable to the frontend expected type. Required fields, enum/literal values,
nullability and union branches follow those directions. Reversing either direction is
not compatibility.

The first framework matrix is intentionally bounded:

| Source family | MVP static surface | Template status |
| --- | --- | --- |
| JS/TS | `fetch`, Axios, configurable clients; TS annotations when statically available | n/a |
| jQuery | `$.ajax`, `$.get`, `$.post`, configured aliases | n/a |
| Solid/React | JS/TS/JSX/TSX call sites using generic recognizers | JSX/TSX supported by shared parser |
| Astro | frontmatter and client `<script>` JS/TS | template expressions unresolved |
| Svelte | `<script>` and `<script lang="ts">` | markup/event-generated calls unresolved |
| Angular | component `.ts` `HttpClient` calls | Angular HTML unresolved until its adapter |
| Vue | `<script>` and `<script setup>` JS/TS in SFCs | template bindings unresolved until its adapter |

Unsupported wrappers, generated SDK boundaries, dynamic URLs, unknown spreads, and
unavailable response/request types remain explicit unresolved evidence.

## acceptance

- A fixture with literal `fetch`, Axios and configurable-client calls produces stable source
  locations, methods and paths through both the CLI and MCP surfaces.
- React TSX/JSX fixture calls are found without changing server route detection.
- Dynamic and unsupported calls remain in output with explicit unresolved reasons; no
  guessed URL or operation is emitted.
- Known calls correlate against discovered operations by normalized method/path, while
  unmatched calls and unconsumed operations are separately counted.
- Angular templates and Vue SFCs are reported as unsupported/unresolved until their
  adapters land; their absence does not make the generic scan fail.
- CLI and MCP use the same engine and structured contract; `generate` and existing
  exporters show no observable regression before S3 is deliberately enabled.
- Every result carries evidence sufficient to explain the match or non-match, including
  file, location, recognizer and confidence.
- A pairwise fixture selects one frontend call and one backend operation explicitly and
  proves: unique selection, ambiguous selection, method/path mismatch, selected response
  status, and separate request/response judgements.
- The compatibility fixture proves request direction (frontend value assignable to the
  backend input), response direction (backend output assignable to the frontend
  expectation), required/optional fields, literals/enums, unions, nullability, and both
  incompatible directions. The reverse assignability directions must not pass.
- For every listed source family, supported static calls are either found or carry a
  stable unresolved reason; unsupported template syntax never becomes a guessed match.
- Dynamic URLs, unknown spreads, unresolved aliases/refs, multiple response statuses,
  and absent type evidence return `unknown` with evidence rather than `incompatible`.
- The type-check phase has a test proving it does not execute or import user source;
  it is a later, separately gated phase and does not make S1/S2 depend on an executable
  project TypeScript configuration.
