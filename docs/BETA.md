# Beta readiness — evidence through 2026-11-10

Tanit has a locally verified technical beta candidate for Linux x64,
Express and Laravel. The package version remains `0.1.0-alpha.2`;
this verification does not constitute a public release.

## Evidence from built artifacts

| Surface | Verified result |
| --- | --- |
| Standalone Linux x64 CLI | Compiled executable starts and exports with `PATH=/usr/bin:/bin`, without Bun or DelendAI on PATH. |
| Express export | OpenAPI 3.1.0: 5 paths, 9 operations; JSON CLI report counts match; local references resolve. |
| Laravel export | OpenAPI 3.1.0: 11 paths, 19 operations; report counts match; local references resolve. |
| Production web UI | Angular production build succeeds. A real isolated Chrome session boots Angular, opens the Express project through the UI, and displays 9 visible / 9 indexed operations in Endpoints Explorer. |
| Browser export | The UI previews the destination, generates a real Postman file in the temporary project, and shows completion plus the persisted history revision. |
| Real web backend | Authenticated project open discovers the same 9 Express operations; unauthenticated requests return HTTP 403. |
| Shared persisted history | A generation recorded by the standalone executable is returned by the web Application API, from the same configured history directory. Browser export also creates a persisted revision showing the same 9 operations in History. |
| Real filesystem watch | Adding an Express route changes the web snapshot from 9 to 10 operations; the observed local rescan completed in about 102 ms. |
| Packed source installation | The generated npm archive installs its production dependencies in an isolated directory; its CLI exports and its prebuilt web UI serves HTTP 200. |

The local measurements are smoke-test observations, not performance
budgets or guarantees for other machines. OpenAPI checks cover structure,
operation counts and resolution of local references; they are not a claim
that every inferred response or schema is complete.

## Reproduction

```bash
bun run build:binary -- --out /tmp/tanit-beta-artifacts
bun run build:app
bun pm pack --destination /tmp/tanit-beta-artifacts

/tmp/tanit-beta-artifacts/apisrc-linux-x64 --help
/tmp/tanit-beta-artifacts/apisrc-linux-x64 generate \
  --project-root /absolute/project --formats openapi --json

bun run ui:web -- --no-open
```

For isolated evaluation, set `TANIT_HISTORY_DIR` and
`TANIT_LEGACY_HISTORY_FILE` to temporary paths. The latter is only the
read-only legacy migration input. Production writes use the common
history repository. Full snapshots can be compared or exported again;
metadata-only history entries explicitly cannot.

Browser checks use a disposable profile and `--password-store=basic`, with
D-Bus disabled for that child process. They require no desktop keyring and
make no changes to the user's credential store. Tests of file opening inject
a launcher instead of opening the system browser.

The verification artifacts for this audit are under
`/tmp/tanit-beta-artifacts-20261109/`; `SHA256SUMS` records their digests
and `SOURCE_COMMIT.txt` records the exact source revision. The rebuilt final
artifacts were checked again: Express 9 operations / 3 resolved local references,
Laravel 19 operations / no unresolved local references.
These local paths are not runtime dependencies or committed machine paths.

## External Express acceptance — 2026-11-10

The public [RealWorld Express example](https://github.com/gothinkster/node-express-realworld-example-app/tree/30b68e1e881462b2f4164ea09ab4c4f5699c7b0b)
was analyzed at that immutable revision without installing its dependencies,
starting its server or executing its project scripts. No third-party source
was copied into this repository.

This run exposed two defects now fixed: an ambient TypeScript declaration
with a null initializer aborted the scan, and chained default-exported routers
lost their `/api` mount. The reviewed baseline contains 20 explicit method/path
pairs: the root `GET /` plus 19 controller operations under `/api`.

After the corrections, the source CLI, standalone Linux binary with only
system tools on PATH, and Application API handlers in browser context all
match those 20 pairs, with no missing or unexpected pairs. Comparison normalizes
path-parameter representation between Postman-style placeholders and contract
paths. This checks method/path identity on one sample; response and schema
accuracy and a broader multi-repository corpus remain separate acceptance work.

Local reports are `tanit-external-realworld-mounts-binary-acceptance-20261110.json`
and `tanit-external-realworld-api-parity-20261110.json` under the temporary
verification directory. They are audit artifacts, not runtime dependencies.
The standalone verification binary is under `/tmp/tanit-x99-binary-20261110/`.

## Scope of the first closed beta

The acceptance scope is CLI plus local web on Linux x64, with Express
and Laravel exercised through actual exports. Other framework scanners
and desktop carriers retain their existing automated tests, but this
manual run does not certify every framework or operating system.

Linux desktop additionally has a known dependency gate: `packages/desktop/Cargo.lock`
contains `glib 0.18.5` through GTK 0.18 / Tauri.
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
affects GLib versions below 0.20 in the relevant release range. The current
GTK dependency range cannot be repaired by independently replacing GLib.
Track the supported upstream migration and audit plus installer checks
before certifying Linux desktop; absence of direct application calls does
not establish that a transitive vulnerability is unreachable. This gate
does not change the verified CLI/local-web scope.

Before an externally distributed beta, finish:

- Acceptance on representative real repositories, beyond reference examples,
  including unsupported and ambiguous routes with honest diagnostics.
- Smoke tests of the desktop installers on the supported operating systems,
  including signature and installation checks.
- Usability evaluation of opening a project, endpoint inspection, Live,
  export approval and history in the visible browser/desktop UI.

A functional local candidate is available now. External beta readiness
means closing those acceptance checks, rather than implementing all future
product ideas at once.

## Product direction

The deterministic source analysis and common Application API remain the
foundation. Existing Swagger/OpenAPI discovery should be reconciled with
code through provenance and explicit conflicts; inferred and unknown data
must remain distinguishable. Git change analysis and thin host adapters
extend that same core.

Optional anonymous remote AI enrichment follows the user's requested flow: first
show the deterministic result, then consult only unresolved endpoint fields or
descriptions when the user enables the UI option. No account, API key, local
model or user-managed relay is a prerequisite.

It stays off by default. Enabling it requires explicit consent before code
is sent; unavailable providers leave the static result usable, and generated
suggestions remain clearly marked. It must
not become a prerequisite for installation or silently turn guesses into
verified API facts. Provider availability needs verification before any
implementation depends on it.


## Tracked acceptance and product follow-ups — 2026-11-10

The canonical proposal documents define the remaining work:

- [External repository corpus](delendai/proposals/ready/tests/t00005-certificar-exactitud-y-paridad-en-repositorios-api-externos-reproducibles.md): fixed revisions, reviewed expectations, endpoint precision/recall and response/schema accuracy measured separately, plus CLI/Application API parity.
- [Swagger discovery and reconciliation](delendai/proposals/INDEX.md): reuse existing import/scanner support, link original documentation, preserve provenance and expose conflicts. Existing OpenAPI import alone does not implement reconciliation.
- [Optional anonymous enrichment](delendai/proposals/INDEX.md): minimal bounded queries, cached by evidence, marked `AI generated`; failures retain the static result. Generated descriptions do not establish verified HTTP behavior. Current provider research is in [AI-ENRICHMENT.md](AI-ENRICHMENT.md).
- [Linux desktop dependency gate](delendai/proposals/blocked/s00001-resolver-bloqueo-glib-transitivo-antes-de-certificar-escritorio-linux.md): blocked on a supported upstream resolution, followed by dependency audit and actual installer acceptance. As verified on 2026-11-10, the Tauri/Wry migration PRs linked in that proposal remain open.

## Remote AI provider check — 2026-11-11

No eligible provider has been verified for distributed product use. The
[llmfaucet project](https://github.com/llmfaucet/llmfaucet) advertises
anonymous access, but its API/docs could not be verified from this environment.
[LLM7 terms](https://github.com/chigwell/llm7.io/blob/main/TERMS.md) require an
API token, and [Pollinations generation requests](https://github.com/pollinations/pollinations/blob/main/gen.pollinations.ai/src/docs/apidocs-recipes.md)
require authentication. Kilo's public catalog confirmed a current zero-cost
anonymous model and one synthetic request returned HTTP 200, but the selected
NVIDIA model's [trial terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)
exclude production and distribution. A previously documented Kilo model ID
returned 404; this does not imply that all Kilo models are unavailable.
Details, limits and policy links are in [AI-ENRICHMENT.md](AI-ENRICHMENT.md).
Nothing here configures a provider or certifies enrichment for product use.

External audit scores are qualitative opinions. Targets such as 98% precision,
95% recall or a 50% token reduction are proposed goals, not measured results.
A frozen candidate still needs full validation and acceptance before a release;
merging development work or closing proposal metadata does not publish a release.
