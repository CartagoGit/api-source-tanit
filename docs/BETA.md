# Beta readiness — 2026-11-09

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

## Scope of the first closed beta

The acceptance scope is CLI plus local web on Linux x64, with Express
and Laravel exercised through actual exports. Other framework scanners
and desktop carriers retain their existing automated tests, but this
manual run does not certify every framework or operating system.

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

Optional anonymous remote AI enrichment is a later, separate capability:
off by default, explicit consent before sending code, best effort when a
provider is unavailable, and clearly marked generated suggestions. It must
not become a prerequisite for installation or silently turn guesses into
verified API facts. Provider availability needs verification before any
implementation depends on it.
