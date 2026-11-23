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
  - "c0f443fa43cb08b71b7f336b927bd2a348cc80ff"
  - "b31ac1028f916a0dc0b4b3ee2f6a180fe7b9c491"
  - "052525b4464628e920744eb2b8f498c6622ed870"
  - "8e1d6ac91e447700743d2d24dd1117a428cc5edd"
  - "b35ad3528cae8dd516bb56967f8d4a3b2b34807a"
  - "b2e9b2b5c08f4abd8115ee42008404159f4e1ea6"
  - "c026bdff4b254bd18b5b8e517b2682ee765b621f"
  - "d66002c2faa0280933dbeddd28928d861141009c"
  - "11f8b444dca8e22e1c46f03b9b7fc50325f3c3c6"
  - "00b784c445ffda7259309a0ca3086cd4b8679499"
  - "7eb6f3d925b23ab8002858eacca8ed8d86a403d7"
  - "a15dcfb6600cd11d2d2a9c3252710e4380e92493"
  - "e6238b2c6bdd1f2de3c3c8b000008c83ced8d85d"
  - "3b68e86151ccaa1d914525802b9a250104c1606e"
  - "0733526aa1c2cf5e35284122b7ecacc10843f487"
  - "950f537a1f2e736ea68585a116d89bf80ef1c705"
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
- **Status**: done
- **Files**: `packages/core/language-frontends/typescript/vue-client-consumption.parser.ts`, `packages/core/discovery/client-consumption.service.ts`, `tests/core/client-consumption.spec.ts`.
- **Gate**: `bun run typecheck && bun run test:core`

- acceptance:
  - A Vue component with one inline script or one script setup returns calls with exact original file, line, column and range.
  - Vue templates remain explicit unsupported evidence. Mixed, external and unsupported script blocks produce diagnostics without confirming calls.
  - The shared result and the MCP schema carry the same diagnostics. Existing CLI and template behavior remains covered.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at c0f443fa43cb, validate exit 0 and tests 199/199 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed innerLoc.start.offset and offsetToPosition remapping; reused the 35 focused contract/core checks and /tmp/tanit-vue-proof.json. (2) Reviewed parseMode=sfc root-only extraction, parse error gate and duplicate/src/lang checks; reused 35 focused contract/core checks and exact-head CI. (3) Reused exact-head CI and reported 6 CLI plus 158 integration tests, /tmp/tanit-vue-wire.out structured parity, /tmp/tanit-vue-windows-smoke.log compiled Window… — Independent approval of a00021 S3 at PR #237 head c0f443fa43cb08b71b7f336b927bd2a348cc80ff, merged as develop 321ddf33; includes parser relocation follow-up 7f8a95eb. Reviewed compiler-dom parseMode=sfc top-level extraction, innerLoc source offsets, location remapping, and malformed/duplicate/external/unsupported-block rejection. S4 remains pending. Reused evidence only; no tests rerun. Exact-head CI passed (GitHub run cited here; no structured runId because it is not journaled in this checkout). Reused 35/35 focused contract/core, 6 CLI and 158 integration tests, plus /tmp/tanit-vue-proof.json, /tmp/tanit-vue-wire.out and /tmp/tanit-vue-windows-smoke.log receipts.

### S4 — Read-only client usage in the Application API
- **Status**: done
- **Files**: `packages/contracts/constants/core/client-consumption.constant.ts`, `packages/contracts/constants/core/application-api.constant.ts`, `packages/contracts/interfaces/core/application-api.interface.ts`, `packages/core/application-api/client-usage.handler.ts`, `tests/application-api/client-usage.spec.ts`.
- **Gate**: scoped Application API and MCP tests plus `bun run validate`
- **Acceptance**:
  - Dispatching `client-usage` returns the canonical analyzer's complete result for frontend discovery with and without an explicit backend.
  - The handler validates absolute roots, reports input and execution errors through the API envelope, and neither opens sessions nor writes project files.
  - The API and MCP share alias validation, and the parity manifest records GUI integration as pending.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at b31ac1028f91, validate exit 0 and tests 208/208 claimed, no recorded run cited; acceptance 3/3: (1) The API handler returns analyzeClientProjects directly; focused API tests compare exact results to the shared analyzer with and without backendRoot. Reused the… (2) Reviewed absolute-path and orchestrator checks plus dispatcher error mapping; tests assert invalid inputs, null sessions and unchanged file tree/source. HTTP r… (3) API and MCP use the shared ClientAnalysisInputSchema; parity row lists client-usage in API, no app operation, and partial status with project selection/report … — Independent approval of a00021 S4 at PR #239 exact head b31ac1028f916a0dc0b4b3ee2f6a180fe7b9c491, merged into develop 88151ec9eeff6a99c5436bb5bc7f0d53373442dd. Reused evidence; no tests rerun. GitHub CI run 45011594729 and ci-summary succeeded. Reused 50/50 focused Application API checks and 158/158 pinned MCP integration checks; /tmp/tanit-app-client-work.json records the work, /tmp/tanit-app-client-wire.json confirms HTTP report parity/token rejection/relative-path rejection, /tmp/tanit-app-client-stdio.json confirms stdio result parity, and /tmp/tanit-app-client-integration.log records the pinned suite. No structured runId: the run is cited here, not claimed as present in the local test journal.

### S5 — Frontend call report and one optional backend in the app
- **Status**: done
- **Files**: `packages/app/src/app/features/client-usage/client-usage.component.ts`, `packages/app/src/app/features/client-usage/client-usage.component.html`, `packages/contracts/interfaces/ui/host-bridge.interface.ts`, `tests/app/client-usage.spec.ts`.
- **Gate**: scoped app tests, Chromium with the actual Application API and `bun run validate`
- **Acceptance**:
  - The browser and desktop app expose the same read-only report without requiring a backend session. The user explicitly selects a frontend and may select a backend separately.
  - The view displays the canonical counts, source positions, unresolved reasons, diagnostics and backend operations without confirmed consumers. Localized status and errors explain what the analyzer verified.
  - The compiled browser route works on reload. When a static web copy has no Application API, it directs the user to the local Tanit service or desktop app.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-5.6-luna
- review-log: requested_changes by openai-gpt-6-luna — Request changes for S5 criterion 1. Native Windows WebView smoke in /tmp/tanit-client-ui-native-smoke.log does not reach API usage from the visible sidebar. With HashLocationStrategy, the navigation callback receives the external hash route; app-shell.component.ts sectionOf splits at # before extracting the section, turning that route into Overview. `go` delegates to Location.go and does not directly set the selected section. Root reproduced the failure twice. The remaining criteria and supplied browser/HTTP evidence were reviewed positively; approval is withheld until desktop navigation is fixed and the actual native journey succeeds. Reused 140/140 Angular tests and CI run 45013452696 as passing evidence; no tests rerun by reviewer. Native package verification is still ongoing; no native app pass is claimed.
- review-log: resubmitted by openai-gpt-6.2-sol — resubmitted; answers the request above: 3f3d3b4d5c6263ce2936f5b52277edbaa3d39f9b. Fixed Tauri HashLocationStrategy navigation by reading the normalized Location.path on URL changes. The regression test with real HashLocationStrategy was red before and green after the fix. All 141 Angular tests and DelendAI work prove passed. Compiled Chromium retained both analysis modes, direct route reload, and the static-web explanation. Windows build 45023995693 tested the same SHA in real WebView2. Clicking the Spanish sidebar item opened Consumo de API at #/client-usage, selected frontend and backend folders, and displayed 1 matched, 1 missing, 1 unknown with no visible sidecar console.
- review-log: approved by openai-gpt-5.6-luna — verified at 052525b44646, validate exit 0 and tests 141/141 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed exact tip 052525b4464628e920744eb2b8f498c6622ed870; Chromium scenarios in /tmp/tanit-client-native-fix-browser.json and native WebView2 smoke in /tmp/… (2) Reused /tmp/tanit-client-native-fix-browser.json and /tmp/tanit-client-native-fix-smoke.log; native run records 1 match, 1 missing, 1 unknown with no visible c… (3) Reused /tmp/tanit-client-native-fix-proof.json, /tmp/tanit-client-native-fix-tested-native-head, and CI 45023995693 as supplied; source 3f3d3b4d5c6263ce2936f5b… — Independent approval of S5 at exact merged PR #243 tip 052525b4464628e920744eb2b8f498c6622ed870. Reused supplied browser, native WebView2, proof, native-head and icon receipts; no tests rerun.

### S6 — Correlate a frontend against explicitly selected backend services
- **Status**: done
- **Files**: `packages/contracts/interfaces/core/client-consumption.interface.ts`, `packages/core/discovery/client-correlation.helper.ts`, `tests/core/client-link-correlation.spec.ts`.
- **Gate**: scoped core and CLI regression tests plus `bun run validate`
- **Acceptance**:
  - The matching engine evaluates the selected links together and uses an explicit hostname when it can identify the destination. Duplicate operation candidates remain ambiguous.
  - A call appears as missing only when it is attributable to a single selected service. When the destination is unclear, the result remains unknown and sibling services receive no false missing calls.
  - Only uniquely matched operations count as confirmed consumers. Ordering and source evidence are preserved, and CLI, MCP and Application API retain their original report contract.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at 8e1d6ac91e44, validate exit 0 and tests 39/39 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed client-correlation.helper.ts: exact selected backend host is preferred; operation hosts are filtered; duplicate operation candidates remain ambiguous … (2) Reviewed correlateClientUsageLinks eligibility and no-match branches: missing is emitted only for one eligible selected service; zero or multiple possible serv… (3) Only a unique candidate adds its operation index to consumed; candidate and unconsumed operation arrays preserve input order; linked calls retain the original … — Independent initial S6 review of exact source PR #245 tip 8e1d6ac91e447700743d2d24dd1117a428cc5edd, merged to develop at 4005864fadebcfb5ae56261959fa8156979ea3ac. Correlation review found explicit selected-host prioritization, stable selected-service/catalog candidate order, and unique-only consumption. Ambiguous candidates remain unconsumed; missing is attributed only when exactly one eligible selected service exists; otherwise unclear calls remain unknown. The extracted single-catalog correlator preserves the previous shape and behavior. Reused focused receipts /tmp/tanit-client-links-focused-0.log through focused-3.log (33 core/CLI and 6 MCP tests), real HTTP and stdio parity/auth/path receipts, and CLI Vue/OpenAPI legacy baseline/after JSON (byte-identical). Proof /tmp/tanit-client-links-proof.json says proved=true. Exact-head GitHub CI run 45026495225 passed including ci-summary. No tests rerun by reviewer.

### S7 — Resolve selected workspace links from canonical project inventories
- **Status**: done
- **Files**: `packages/core/discovery/client-usage.service.ts`, `packages/contracts/interfaces/core/client-consumption.interface.ts`, `tests/core/client-project-links.spec.ts`.
- **Gate**: scoped core and CLI regression tests plus `bun run validate`
- **Acceptance**:
  - One request can compare several frontends and several explicitly selected backend services. Real paths and canonical service IDs identify links and preserve their order.
  - Each distinct frontend root is read once with the selected aliases, and each backend root generates its inventory once. Source reads close their indexes and leave project files and sessions untouched.
  - Unknown and duplicate selections fail explicitly. The existing single-frontend report and CLI, MCP and Application API output retain their format.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-5.6-luna
- review-log: approved by openai-gpt-5.6-luna — verified at b35ad3528cae, validate exit 0 and tests 44/44 claimed, no recorded run cited; acceptance 3/3: (1) Reused /tmp/tanit-client-project-links-focused-1.log (44 scoped tests) and /tmp/tanit-client-project-links-work.json; tests cover symlinked physical-root cachi… (2) Reused /tmp/tanit-client-project-links-focused-2.log: exact before/after Vue+OpenAPI JSON is identical; focused fixture verifies host-qualified selection, ambi… (3) Reused /tmp/tanit-client-project-links-focused-0.log, focused-3.log (6 MCP tests), canonical HTTP/stdio parity receipts, and final proof: ambient symlink type … — Independent approval of S7 at exact merged PR #247 head b35ad3528cae8dd516bb56967f8d4a3b2b34807a. Reused supplied 44 scoped + 6 MCP tests, real HTTP/stdio parity, identical legacy fixture, and final ambient type-fix proof; no tests rerun.

### S8 — Read-only project candidates and selected links in the Application API
- **Status**: done
- **Files**: `packages/contracts/constants/core/client-consumption.constant.ts`, `packages/core/application-api/client-candidates.handler.ts`, `packages/core/application-api/client-links.handler.ts`, `tests/application-api/client-links.spec.ts`.
- **Gate**: scoped Application API tests, actual HTTP and stdio bridge checks, and `bun run validate`
- **Acceptance**:
  - Candidate lookup shows concrete workspace folders and canonical backend service IDs, with the detected framework for each service. The IDs round-trip into comparison.
  - The typed API returns the complete shared multi-project result and performs no project writes or session changes.
  - Invalid payloads and relative roots return structured errors, and the existing single-project report remains available.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at b2e9b2b5c08f, validate exit 0 and tests 95/95 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed the merged S8 implementation and focused fixture. Workspace globs materialize the actual apps/admin and apps/storefront directories. Backend lookup re… (2) Focused API tests compare dispatch output to analyzeClientProjectLinks, verify both selected frontend reports, unchanged fixture file contents and directory en… (3) Focused dispatcher tests cover strict unexpected-field rejection and relative roots as INVALID_INPUT envelopes. The existing client-usage handler remains regis… — Independent g48 review of S8 at merged PR #249 source head b2e9b2b5c08f4abd8115ee42008404159f4e1ea6; implementation commit 0a1f17e99442b8b9ffaba8db2fd11ee55659d2af. Reused the 95 targeted passing tests, passing work proof, and real HTTP/stdin-stdout receipt showing identical canonical results for two expanded packages with matched, missing, and unknown statuses. Exact-head GitHub CI run 45082341463 passed including ci-summary. No tests rerun by reviewer.

### S9 — Select and compare project links in the web and desktop app
- **Status**: done
- **Files**: `packages/app/src/app/features/client-usage/client-links.component.ts`, `packages/app/src/app/features/client-usage/client-links.component.html`, `packages/contracts/interfaces/ui/host-bridge.interface.ts`, `tests/app/client-links.spec.ts`.
- **Gate**: targeted app tests, real Chromium and Windows WebView checks, and `bun run validate`
- **Acceptance**:
  - The workspace mode uses concrete candidate roots and exact service IDs. The user selects which links to compare, and the single-project mode is still usable.
  - The view presents the canonical report grouped by frontend with call evidence, ambiguities, diagnostics and backend operations without a confirmed consumer.
  - Chromium and desktop can run selected links using the real Application API. Static web copies explain the local-service requirement.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-5.6-luna
- review-log: approved by openai-gpt-5.6-luna — verified at c026bdff4b25, validate exit 0 and tests 145/145 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed exact merged PR #251 tip c026bdff4b254bd18b5b8e517b2682ee765b621f and Chromium receipt /tmp/tanit-client-workspace-ui-browser.json; workspaceVerified … (2) Browser receipt records all four states; reviewed client-links template rendering of source positions, statuses, unresolved reasons, ambiguity candidates, diag… (3) Reused /tmp/tanit-client-workspace-ui-browser.json (mobileFits and staticExplains true), 145 Angular tests, exact native tested-head stamp, Windows build 45084… — Independent approval of S9 at exact merged PR #251 tip c026bdff4b254bd18b5b8e517b2682ee765b621f. Reused 145 Angular tests, Chromium receipt, Windows WebView2 smoke, native tested-head and icon receipts; no tests rerun.

### S10 — Select project links through the CLI
- **Status**: done
- **Files**: `packages/cli/commands/client-candidates.script.ts`, `packages/cli/commands/client-links.script.ts`, `tests/e2e/client-workspace.test.ts`.
- **Gate**: targeted CLI tests, compiled Windows smoke, and `bun run validate`
- **Acceptance**:
  - CLI candidate discovery returns concrete workspace folders and canonical backend service IDs from the shared inventory.
  - A JSON selection plan resolves relative roots from the plan directory and returns the same read-only selected-link report as the core.
  - Invalid plans return a nonzero exit and a readable error. The original `client-usage` command remains available.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at d66002c2faa0, validate exit 0 and tests 11/11 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed both CLI adapters against the shared candidate engine and S10 E2E fixture. Frontend candidates are concrete materialized workspace roots; backend cand… (2) The plan adapter resolves frontend/backend roots from dirname(planPath), strips a UTF-8 BOM, and delegates to analyzeClientProjectLinks with the shared schema.… (3) E2E covers malformed JSON, schema-invalid plan, missing and unsupported CLI options with nonzero exit, empty stdout and readable stderr. COMMANDS still registe… — Independent g52 review of S10 at merged source PR #253 head d66002c2faa0280933dbeddd28928d861141009c, implementation commit e31b45f3df54048e30f05892197f0dcdcb9c1e2a, integrated at develop 0a9b3387d72757df44c751557b73d8a037b48f8d. Reused 11 passing CLI E2E cases, CLI/e2e typechecks and command-parity checks, compiled Windows receipt /tmp/tanit-client-workspace-cli-windows.json (UTF-8 BOM plan from a different cwd, no project writes, all four semantic states), and exact-head CI run 45086669852. No tests rerun by reviewer.

### S11 — Select project links through MCP
- **Status**: done
- **Files**: `packages/core/discovery/workspace-glob.helper.ts`, `tests/core/workspace-glob.spec.ts`, `docs/CLI.md`.
- **Gate**: pinned MCP carrier tests plus `bun run validate`
- **Acceptance**:
  - The pinned DelendAI integration exposes concrete candidate folders and canonical service IDs from the shared inventory.
  - Explicit link plans return the same canonical report as the CLI, including diagnostics and operations without a confirmed consumer.
  - All roots stay inside the workspace, including physically resolved directories. The existing single-project tool retains its input and output.

The adapters are `integrations/delendai/src/lib/tools/client-candidates.tool.ts`
and `integrations/delendai/src/lib/tools/client-links.tool.ts`, with regression
coverage in `integrations/delendai/tests/integration/client-workspace.tool.spec.ts`.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-5.6-luna
- review-log: approved by openai-gpt-5.6-luna — verified at 11f8b444dca8, validate exit 0 and tests 161/161 claimed, no recorded run cited; acceptance 3/3: (1) Reused /tmp/tanit-client-workspace-mcp-wire.json: sameCLI=true, newToolsAdvertised=true, originalTool=true, and the pinned live MCP/CLI result matches. (2) Reused /tmp/tanit-client-workspace-mcp-wire.json (readOnly=true, statuses ambiguous/matched/missing/unknown), targeted 53/53 log, and inspected createContained… (3) Reused /tmp/tanit-client-workspace-mcp-integration.log (161/161 integration tests plus typecheck), /tmp/tanit-client-workspace-mcp-targeted.log (53/53), and pr… — Independent approval of S11 at exact merged PR #255 tip 11f8b444dca8e22e1c46f03b9b7fc50325f3c3c6. Reused 161/161 integration plus typecheck, 53/53 targeted, real pinned MCP/CLI wire parity and proof receipts; no tests rerun.

### S12 — Recognize Angular HttpClient in TypeScript
- **Status**: done
- **Files**: `packages/core/language-frontends/typescript/client-consumption.helper.ts`, `packages/contracts/interfaces/core/client-consumption.interface.ts`, `tests/core/client-consumption.spec.ts`.
- **Gate**: core client analysis and pinned MCP tests plus `bun run validate`
- **Acceptance**:
  - Angular instance methods and their lexical callbacks recognize constructor parameter properties typed as the imported Angular HttpClient and instance fields initialized with the imported Angular inject function.
  - Static verb calls and the method and URL overload of request preserve source coordinates. Dynamic requests retain unresolved evidence and unproven receivers do not produce confirmed calls.
  - The same recognizer appears in the canonical report and the pinned MCP schema. Angular HTML remains a template diagnostic.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at 00b784c445ff, validate exit 0 and tests 40/40 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed the exact source diff and focused fixtures: the recognizer requires named imports from @angular/common/http and @angular/core, associates candidate cl… (2) Focused tests cover static HTTP verbs, request("PATCH", "/items"), dynamic method and URL, and receiver scoping. The real decorated-component wire receipt conf… (3) Core contract and pinned integration output schema both include angular-http-client; pinned MCP integration tests verify the same matched usage. The actual dec… — Independent g56 review of S12 at merged PR #257 exact head 00b784c445ffda7259309a0ca3086cd4b8679499, integrated at develop b005f546. Reused 40 core tests, core typecheck, 162 pinned integration tests plus typecheck, local work prove, real decorated-component wire parity with exact column/start/end offsets, Chromium ui:dev browser receipt and native Windows WebView2 receipt with no visible console. Exact-head CI 45128239841 passed. No tests rerun by reviewer.

### S13 — Recognize verified Angular HttpClient calls in external templates
- **Status**: done
- **Files**: `packages/core/discovery/client-consumption.service.ts`, `packages/core/language-frontends/typescript/angular-client-template.parser.ts`, `tests/core/client-consumption.spec.ts`.
- **Gate**: Angular template parser, package proof and shared client parity plus `bun run validate`
- **Acceptance**:
  - A literal external template referenced by exactly one component with a real Angular Component decorator recognizes a direct event call on its explicitly qualified HttpClient receiver.
  - Static and unresolved calls preserve original HTML file and source coordinates. Unproved ownership, non-explicit receivers and unsupported syntax remain diagnostics.
  - The generic scanner retains existing behavior for JavaScript, TypeScript and Vue, and the packaged CLI loads the template parser without project dependencies.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-5.6-luna
- review-log: approved by openai-gpt-5.6-luna — verified at 7eb6f3d925b2, validate exit 0 and tests 162/162 claimed, no recorded run cited; acceptance 3/3: (1) Reused /tmp/tanit-s13-angular-proof.json and 45 targeted checks; prior source inspection found literal templateUrl ownership, conservative this.member HTTP mat… (2) Reused pinned integration suite 162/typecheck, real CLI/stdio CRLF span receipts, Chromium and compiled Windows/WebView2 receipts; g57 returned the normal shar… (3) Reused /tmp/tanit-s13-angular-packed-cli.json clean installed tarball proof, package proof, scoped typecheck and pinned integration evidence; no tests rerun by… — Independent approval of S13 at exact merged PR #259 tip 7eb6f3d925b23ab8002858eacca8ed8d86a403d7. Reused Angular proof, 45 targeted plus 162 pinned integration checks/typecheck, CRLF CLI/stdio spans, clean tarball, Chromium and Windows/WebView2 receipts; no tests rerun.

### S14 — Compare static JSON requests with a selected backend contract
- **Status**: done
- **Files**: `packages/core/discovery/client-usage.service.ts`, `packages/core/schema/json-request-comparison.helper.ts`, `packages/frameworks/scanners/openapi.scanner.ts`, `tests/core/client-request-contract.spec.ts`.
- **Gate**: focused contract and carrier tests plus `bun run validate`
- **Acceptance**:
  - An opt-in plan compares a literal fetch JSON body with the direct OpenAPI declaration on the uniquely selected operation.
  - Unsupported evidence stays unknown. Incompatible requests have specific reasons, and request body values never enter the report.
  - CLI, Application API and the pinned integration return one canonical result. Plans without the option keep the existing report.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at a15dcfb6600c, validate exit 0 and tests 39/39 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed the exact source diff and S14 fixture: request bodies are compared only when compareRequestBodies is enabled, the call uniquely matches a selected ope… (2) The bounded checker returns unknown for unsupported schema/body evidence and specific reasons for invalid JSON, missing/unexpected fields, type and enum mismat… (3) The real wire receipt reports canonicalParity=true across CLI, Application API stdio and DelendAI MCP stdio, including compatible/incompatible/unknown results … — Independent g60 review of S14 at merged source PR #261 exact head a15dcfb6600cd11d2d2a9c3252710e4380e92493, integrated at develop b83e3328. Reused 39 targeted tests, 85 OpenAPI tests, 162 pinned integration tests, core/framework/CLI typechecks, local work proof, real CLI/Application API stdio/pinned MCP canonical parity receipt, and Windows native receipt confirming no body values in output. Exact-head CI 45133301603 and ci-summary passed. No tests rerun by reviewer.

### S15 — Compare backend responses with frontend expectations
- **Status**: done
- **Files**: `packages/core/discovery/client-usage.service.ts`, `packages/core/schema/json-request-comparison.helper.ts`, `packages/frameworks/scanners/openapi.scanner.ts`, `tests/core/client-response-contract.spec.ts`.
- **Gate**: selected response status and cross-carrier tests plus `bun run validate`
- **Acceptance**:
  - An opt-in comparison uses one declared JSON success response from the uniquely matched backend operation and one proven inline Axios expectation.
  - The backend-to-frontend check accounts for guaranteed fields, optionality, nullability and supported scalar unions. Unsupported or ambiguous evidence stays unknown.
  - CLI, Application API and pinned MCP return the same verdict and source without raw schema values. Existing plans keep their report and response checks can run alongside request checks.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-5.6-luna
- review-log: approved by openai-gpt-5.6-luna — verified at e6238b2c6bdd, validate exit 0 and tests 104/104 claimed, no recorded run cited; acceptance 3/3: (1) 104/104 targeted tests; /tmp/tanit-s15-proof.json proved=true; source review of response parser/scanner and /tmp/tanit-s15-wire.json status=200. (2) tests/core/client-response-contract.spec.ts covers compatible/incompatible/unknown verdicts, nullable/integer/open/multiple-status cases; exact-head CI 4519382… (3) /tmp/tanit-s15-wire.json parity=true and omitsSchemaValues=true; supplied CLI/WebView2 receipts plus 162 pinned integration tests; typechecks green. — Independent official g62 review: S15 satisfies all three acceptance criteria. Backend-to-frontend assignability is directional and handles guaranteed fields, optionality, nullability, and supported scalar/literal unions; unsupported or ambiguous evidence remains unknown. Response selection requires exactly one concrete declared 2xx JSON response and one proven inline Axios expectation. Comparison is opt-in and request checks compose without changing existing reports. Raw schema values are omitted and CLI/Application API/pinned MCP parity is proven. Minor conservative handling of OpenAPI default response keys does not violate the stated acceptance. Exact-head CI 45193827693 and ci-summary were supplied by the review record (not present in this checkout journal).

### S16 — Analyze mixed Vue script scopes
- **Status**: done
- **Files**: `packages/core/language-frontends/typescript/vue-client-consumption.parser.ts`, `packages/core/language-frontends/typescript/client-consumption.helper.ts`, `tests/core/client-consumption.spec.ts`.
- **Gate**: focused Vue script and cross-carrier fixtures plus `bun run validate`
- **Acceptance**:
  - One normal script and one setup script of the same supported language share hoisted imports while their local declarations resolve in the correct scope.
  - Both script blocks retain original Vue locations, including request and response evidence consumed by the linked-project report.
  - Conflicting and unsupported scripts and unmodeled Vue templates remain explicit diagnostics. CLI, Application API and pinned MCP return the canonical result.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-5.6-luna
- review-log: approved by openai-gpt-5.6-luna — verified at 3b68e86151cc, validate exit 0 and tests 52/52 claimed, no recorded run cited; acceptance 3/3: (1) 52 focused tests include hoisting/isolation/dedupe/conflict fixtures; source review confirms separate classic/setup scopes, import identity dedupe, and cross-b… (2) Focused fixtures assert exact original CRLF line/column/start/end offsets and observer-location identity; /tmp/tanit-s16-wire.json reports exactVueOffsets=true… (3) Unsupported duplicate/conflicting/external/language branches return explicit diagnostics; /tmp/tanit-s16-wire.json reports templateDiagnostic=true and parity=t… — Independent official g64 review: S16 satisfies all three acceptance criteria. One normal Vue script plus one setup script of the same supported language share hoisted imports while local declarations remain lexically isolated; same-block static resolution retains declaration-before-use safety and cross-block initializers are intentionally not statically resolved. Both blocks map usage and request/response observer locations back to original Vue coordinates, including CRLF offsets. Conflicting/unsupported scripts and unmodeled templates remain explicit diagnostics. Supplied proof covers 52 focused tests, 162 pinned integration tests, core typecheck, real three-carrier parity, Vue compiler 3.5.46 fixtures, Windows receipts, exact offsets, and work prove evidence.

### S17 — Expose optional consumer evidence to exporters
- **Status**: done
- **Files**: Application API preview, export and history handlers, the shared client analyzer and OpenAPI exporter, with application and exporter fixtures.
- **Gate**: backward compatibility and exporter tests plus `bun run validate`
- **Acceptance**:
  - An explicit frontend selection previews and writes an OpenAPI artifact for a single identified snapshot service using the canonical link analysis, with read-only preview and matching byte counts.
  - Only attributable operations receive positive call and distinct frontend counts. Unknown or ambiguous calls and calls to a different host are excluded. Duplicate rendered and expanded ALL operations lack the extension. Client paths and values stay outside artifacts and persisted export evidence.
  - Default exports retain their bytes and previously recorded exports remain readable. Re-exporting an annotated OpenAPI revision preserves the original counts even after edits to the frontend.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-5.6-luna
- review-log: approved by openai-gpt-5.6-luna — verified at 0733526aa1c2, validate exit 0 and tests 55/55 claimed, no recorded run cited; acceptance 3/3: (1) 55/55 focused tests; /tmp/tanit-s17-proof.json proved=true; /tmp/tanit-s17-wire.json and /tmp/tanit-s17-windows.json report previewReadOnly=true and byteParity… (2) Focused exporter/e2e fixtures cover attribution exclusions and sanitized artifacts; WSL/Windows receipts report confirmedCalls=2, frontends=2, aliasPreserved=t… (3) /tmp/tanit-s17-history-wire.json and /tmp/tanit-s17-history-windows.json report historyRestored=true and byteParity=true; target normalization and history-rest… — Independent official g66 review: S17 satisfies all three acceptance criteria. Explicit frontend selection reuses the canonical link analyzer against the identified single-service snapshot; preview and write share the prepared artifact and byte counts. Aggregation admits only uniquely attributable concrete operations, excludes unknown/ambiguous calls, duplicate rendered operations, and ALL expansions, and persists only sanitized method/URI/count evidence. Default bytes remain unchanged and persisted history re-export preserves the original annotated revision, including target normalization and restored history behavior. Evidence includes 55/55 focused tests, 162 pinned integration tests, exact CI 45262622070 with ci-summary and desktop-tests, /tmp/tanit-s17-proof.json, real WSL/Windows three-carrier and history receipts, and publish proof.

### S18 — Resolve Vue template client bindings
- **Status**: done
- **Files**: Vue component parser, the shared TypeScript call recognizer and Vue client discovery fixtures.
- **Gate**: focused Vue event scope fixtures, real Vue 3.5.46 compiler evidence, canonical report parity and `bun run validate`
- **Acceptance**:
  - Static named Vue events report single direct HTTP calls only for proven Axios or configured module imports visible through script setup, including shared runtime imports from a paired script.
  - Original file, CRLF line and column and exact source ranges accompany calls. The existing script analysis and operation matching remain canonical across CLI, Application API and pinned MCP.
  - Template-generated scopes, unproved receivers, delegated handlers and unsupported expressions preserve an explicit diagnostic. Plain markup produces no unsupported-call diagnostic.
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-5.6-luna
- review-log: approved by openai-gpt-5.6-luna — verified at 950f537a1f2e, validate exit 0 and tests 63/63 claimed, no recorded run cited; acceptance 3/3: (1) 63/63 final focused tests; /tmp/tanit-s18-template-wire.json provenEvents=3, scopedHandlerDiagnosed=true, compilerVersion=3.5.46; source/fixture review covers … (2) /tmp/tanit-s18-template-wire.json exactOffsets=true and parity=true; Windows receipt exactOffsets=true; supplied binary-equivalence head bf16b00723ed67b36f4b45… (3) Wire receipt scopedHandlerDiagnosed=true; focused fixtures cover v-for/v-slot/unknown/delegated branches and plain markup; final 162/162 integration receipt at… — Independent official g68 review: S18 satisfies all three acceptance criteria. Direct Vue events are emitted only for proven Axios/configured imports visible through script setup, including paired-script shared imports; generated scopes and unproved receivers remain unsupported. Source mapping preserves original CRLF coordinates and exact ranges, and the canonical scanner/report path remains shared across carriers. Plain markup is quiet while v-for/v-slot/delegated/unsupported handlers retain diagnostics. Final evidence is 63/63 focused tests, final 162/162 integration tests (the earlier appended failure predates the fixture fix), compiler 3.5.46 parity, Windows binary equivalence tested at the supplied head, exact offsets, work proof, and CI 45267772829 with ci-summary and desktop-tests.

### S19 — Verify frontend syntaxes and HTTP transports independently
- **Status**: pending
- **Files**: client analysis fixtures and the supported syntax and transport reference.
- **Gate**: representative version-pinned fixtures and canonical report parity plus `bun run validate`
- **Acceptance**:
  - Document verified combinations by language, source form, relevant framework version and client transport. Report dynamic or unverified forms as unknown when static evidence is insufficient.
  - Reuse JavaScript and TypeScript call recognizers wherever import and receiver evidence survives. Cover native Fetch, XMLHttpRequest and client libraries by proven call forms. Add framework adapters for distinct semantics, such as AngularJS services and framework templates, with their own fixtures.

### S20 — Present contract comparisons and source evidence in Angular
- **Status**: pending
- **Files**: Angular comparison feature, shared UI primitives, translations and end-to-end fixtures.
- **Gate**: localized browser and desktop journeys plus `bun run validate`
- **Acceptance**:
  - Mark HTTP methods consistently in lists and details. Browse from an overview by project and service to endpoint and call details. Show shared or discrepant fields, evidence locations and the reason for every available request and response verdict.
  - Show actionable suggestions derived from explicit reasons, including missing fields, incompatible known types and insufficient evidence. Keep frontend expectations and backend contracts labeled by direction and source.
  - Use the canonical comparison data and shared components with keyboard navigation, sensible responsive layouts and reduced-motion support.

### S21 — Report detected project technologies from local evidence
- **Status**: pending
- **Files**: shared project and service discovery, technology contracts, local fixtures and surface adapters.
- **Gate**: mixed monorepo fixtures and CLI, Application API and MCP parity plus `bun run validate`
- **Acceptance**:
  - Group frontend and backend technologies by actual workspace or service. Support evidence from workspace manifests, dependencies, lockfiles and imports, with Laravel and a mixed JS/TS monorepo represented in the fixture set.
  - Distinguish a declared range, a resolved version and unknown version. Cite the originating project-relative file and preserve conflicting evidence without inferring framework versions from source syntax.
  - Keep runtime scan local and deterministic. Share canonical technology and observed HTTP mechanism identifiers across CLI, Application API, MCP and their consumers. Expose official documentation references from a maintained registry.

### S22 — Show detected technologies in project summaries and call details
- **Status**: pending
- **Files**: Angular project overview and comparison details, shared symbols, translations and end-to-end fixtures.
- **Gate**: monorepo browsing and accessibility checks plus `bun run validate`
- **Acceptance**:
  - In project and service summaries, show detected frontend and backend technologies with text labels and known logos, observed HTTP mechanisms, version evidence and official documentation. Use compatible practical fallbacks for unknown values and missing icons.
  - Let users expand specific requests and endpoints to see how they were recognized and how that relates to the scanned version. Keep advertised support, detected versions and observed syntax visually distinct.
  - Verify equivalent project facts in the desktop and web views and usable layout at compact widths, with keyboard and screen-reader support.

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
