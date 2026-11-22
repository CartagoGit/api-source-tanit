---
id: a00021
title: "Static frontend consumption discovery across Angular, Vue, and React"
kind: audit
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-21
last-transition-id: 309b88f5-fbf1-46dd-a80a-a2486ebb5dc9
last-correlation-id: 309b88f5-fbf1-46dd-a80a-a2486ebb5dc9
last-transition-from: ready
last-transition-at: 2026-11-22T01:06:20.840Z
shipped-in:
  - "34f558b81e2271078f388a248649f1450f8f08cf"
  - "6f466445e63e701e3095cb6b077d24070b011cc2"
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
- **Status**: done
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
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at 34f558b81e22, validate exit 0 and tests 32/32 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed scanClientConsumption, AST cache reuse and parser fallback at PR #233 head 34f558b81e2271078f388a248649f1450f8f08cf; GitHub CI validation run 44970766… (2) Reviewed typed Babel traversal, binding shadowing, fetch/Axios/configured alias recognition, static strings, option/method handling, and parse diagnostics at m… (3) Reviewed normalized URL host/path behavior and correlation candidate matching/ambiguity in packages/core/discovery/client-consumption.service.ts at merged PR #…

### S2 — CLI and MCP read-only surface
- **Status**: done
- **Files**: `packages/cli/commands/client-usage.script.ts`, `packages/core/discovery/client-usage.service.ts`, `tests/e2e/client-usage.test.ts`.
- **Gate**: `bun run typecheck && bun run test:core`

Expose a dedicated `clients`/`client-usage` read-only command and MCP tool. It should return
the usage records, matched/unmatched operation counts, unresolved reasons, and diagnostics.
Do not alter `generate`, collection files, or persisted project state in this slice. The
CLI and MCP entry points must call the same shared engine and return structured data rather
than parse human output. The optional MCP entry point is
`integrations/delendai/src/lib/tools/client-usage.tool.ts`. DelendAI 0.3.0
normalizes the nested integration's `src/` as a workspace root in the Files field.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at 6f466445e63e, validate exit 0 and tests 163/163 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed client-usage service and both adapters; /tmp/tanit-consumers-wire.out records structured parity and matching, missing, unresolved outcomes. (2) Reviewed strict schemas, lexical plus realpath containment, in-memory ProjectIndex lifecycle and backend spec scan; 157 integration tests are reported green by… (3) GitHub CI run 44973565080 passed at 6f466445e63e701e3095cb6b077d24070b011cc2; 6 focused CLI tests passed per CI. Reused /tmp/tanit-consumers-proof.json and Win… — Independent review of a00021 S2 at PR #235 head 6f466445e63e701e3095cb6b077d24070b011cc2 (source change faa084a9; follow-up docs/gate fix ef05691d). Reviewed shared client-usage service, CLI, strict MCP schema/tool and workspace containment, tests and docs. No actionable issue found. Reused evidence; no tests rerun. GitHub CI run 44973565080 passed for the exact PR head; 6 focused CLI tests and 157 integration tests are reported as passing by the CI/proof artifacts, not locally journaled in this review checkout. /tmp/tanit-consumers-proof.json and /tmp/tanit-consumers-wire.out show proof/parity; /tmp/tanit-consumers-windows-smoke.log shows compiled Windows smoke.

### S3 — Detect client calls in an inline Vue script
- **Status**: pending
- **Files**: `packages/core/language-frontends/vue/vue-client-consumption.parser.ts`, `packages/core/discovery/client-consumption.service.ts`, `tests/core/client-consumption.spec.ts`.
- **Gate**: `bun run typecheck && bun run test:core`

- acceptance:
  - A Vue component with one inline script or one script setup returns calls with exact original file, line, column and range.
  - Vue templates remain explicit unsupported evidence. Mixed, external and unsupported script blocks produce diagnostics without confirming calls.
  - The shared result and the MCP schema carry the same diagnostics. Existing CLI and template behavior remains covered.

### S4 — Remaining framework adapters, application view, and exporter sequencing
- **Status**: pending
- **Files**: adapter and UI/export files to be selected after S1/S2 evidence.
- **Gate**: scoped tests plus `bun run validate`

Sequence adapters after the generic engine: (a) React TSX/JSX call sites, which reuse the
existing parser; (b) Angular TypeScript plus a separate Angular-template extractor; (c)
Vue SFC mixed script scopes and template bindings. Only after the
read-only result is stable should the Application API expose a client-usage view and an
exporter optionally add consumer metadata. Export output must remain backward compatible
and client analysis must remain optional.

### Pairwise comparison and selection boundary

Pairwise comparison is a read-only phase after S2. Accept separately selected roots and a
monorepo root. For a monorepo, reuse existing workspace and service discovery and show
candidate frontends and backend services with their relative paths and detected roles.
Allow the user to add or correct candidates manually, including applications with both
roles. Discovery proposes candidates; the user chooses which frontend-to-backend links
to compare. A single frontend and single backend selected explicitly make one link.

Each link connects a frontend application to a backend service. A frontend can use
several services, and several frontends can use the same service. Analyze each distinct
root once and evaluate only selected links. Use canonical workspace-relative paths with
project identity for frontend applications and the snapshot's service id within its
backend root. Display names are labels. For example, `apps/storefront` can use
`apps/catalog-api` and `apps/orders-api`, while `apps/admin` uses only
`apps/catalog-api`. This selection creates three links.

Within a link, pair unique matches on HTTP method and normalized path. A link may
declare its own base URL, gateway prefix, or route-prefix mapping. Respect known hosts
and keep method, path, and normalization evidence. If a call in a frontend with several
selected links can reach more than one service, report `ambiguous` with the candidate
links and operations until host or prefix evidence, or an explicit user choice, resolves
it. A selected link scopes comparison; identical method and path on two selected
services alone is insufficient evidence to assign a call to either. Within a service,
report ambiguity for duplicate operation candidates as well. Use a stable operation id
where available, otherwise the service, method and path with source position to
distinguish duplicates. Retain the frontend's source file, location and recognizer.

Report `matched`, `missing`, `ambiguous`, or `unknown` by approved link. A missing
backend operation means the call is attributable to that link and no operation matches.
A backend operation may have no statically visible consumer in the selected frontend.
A call attributed to one backend does not contribute a missing call to its siblings.
Track insufficient evidence as `unknown`, including unresolved calls whose intended
destination is unclear. Each row includes available evidence from both sides, with
the recognizer, normalization notes, confidence, and reason. Hosted web uses the
same Application API and only offers project selection where a backend can read
the chosen directories.

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
- Angular templates, Vue template bindings and mixed Vue script scopes retain diagnostics
  until their adapters land. Their absence does not make the generic scan fail.
- CLI and MCP use the same engine and structured contract; `generate` and existing
  exporters show no observable regression before exporter integration is deliberately enabled.
- Every result carries evidence sufficient to explain the match or non-match, including
  file, location, recognizer and confidence.
- A two-root fixture analyzes each root once and automatically matches unique operations.
  A monorepo fixture discovers multiple candidate applications and verifies manual
  additions, one frontend with two backends, and two frontends sharing a backend. Only
  selected links produce results, which retain project and service identity across runs.
- Two selected backend services both expose `GET /v1/items`. An unqualified call remains
  ambiguous. A known host, a per-link gateway prefix, or an explicit resolution assigns
  the call to one service without a missing-call error against the other. The selected
  status and separate request and response judgements use only that service's schemas.
- The pairing fixture separately proves `matched`, `missing`, `ambiguous`, and `unknown`,
  with source evidence, a known method mismatch, and deterministic per-link totals.
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
