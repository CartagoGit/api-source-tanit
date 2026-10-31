# CLI parity

The product has two faces and one backend.

- The **CLI** (`apisrc <command>`) is the functional reference: what
  the tool can do.
- The **desktop app** (`packages/app`, Angular inside Tauri) is the
  same tool with a face instead of commands.
- The **Application API** (`packages/core/application-api`) is the one
  place that knows how to do it. The CLI and the app are both clients
  of it; neither reimplements it.

## How the app talks to the backend

Through the **connector** (`packages/contracts/interfaces/ui/host-bridge.interface.ts`).
It declares the operations the app can ask for, with their real inputs
and outputs, named exactly as the API registers them.

Two carriers, one contract:

| Carrier | Transport | Used by |
| --- | --- | --- |
| Tauri | the `apisrc serve --stdio` sidecar, over IPC | the desktop app |
| Browser | `POST /api` on loopback, with a per-run token | the app in a browser |

The app does not know which one is running. That is the point: what is
verified in the browser is what runs in the app, because both go
through the same connector over the same registry.

```bash
bun run build:app   # compile the app
bun run ui:web      # serve it in the browser, against the real backend
```

`ui:web` serves the compiled app and the Application API on **one
origin** — the page asks for `POST /api` with a relative path, and a
relative path means "the origin that served me". The token travels in
the served HTML (`data-tanit-token` on the `<html>` element), which is
the only place same-origin policy stops a third party from reading it.

## The map, and the gate that checks it

The map of what each face can reach lives in
[`packages/contracts/constants/core/cli-app-parity.constant.ts`](../packages/contracts/constants/core/cli-app-parity.constant.ts),
and
[`scripts/gates/lint-cli-app-parity.script.ts`](../scripts/gates/lint-cli-app-parity.script.ts)
checks it on every build. The gate fails when:

- a CLI command is not in the map — a new command with no app
  counterpart is invisible drift;
- a map entry names an Application API handler that does not exist;
- the app asks for an operation that has no handler and does not
  declare it pending — that call would answer `UNKNOWN_HANDLER`;
- a pending operation **already has** a handler — the backlog entry
  has expired and the app has to use it;
- a pending operation the app no longer asks for — the list has to
  shrink with the app.

The last two are what make the backlog a list of work that empties
itself instead of a comment that rots.

## The map, today

The table below is the map, as `bun run lint:cli-app-parity` reads it.
The gate prints the same counts on every build:

```text
lint:cli-app-parity — 12 comando(s) del CLI, 20 handler(s) en la API, 23 operación(es) pedidas por la app.
  Paridad: 10 completa(s), 2 parcial(es), 0 con hueco(s).
```

| Capability | CLI | Application API | Status |
| --- | --- | --- | --- |
| generate | `generate`, `sync` | `export`, `dry-run`, `sync` | covered |
| detect | `scan`, `list` | `snapshot`, `list-endpoints`, `list-services`, `get-endpoint`, `get-schema` | covered |
| drift | `check` | `check` | covered |
| validate | `validate` | `validate` | covered |
| push | `push` | `push` | covered |
| stats | `stats` | `stats` | covered |
| watch | `watch` | `watch`, `cancel` | covered |
| history | `history` | `history` | partial |
| projects | — | `open-project`, `list-projects`, `close`, `browse` | covered |
| settings | — | `settings` | partial |
| interface | `ui` | — | covered (carrier) |
| service | `serve` | — | covered (carrier) |

**A gap is not a bug in the map; it is the map doing its job.** The
honest thing is to write it down rather than pretend the two faces are
equal when they are not. Each gap says, in the map, what would have to
exist for the app to reach it.

`interface` and `service` are carriers: they are how each face is
reached, not a business capability. They are in the map so the gate can
see that every command is accounted for.

## What the app does now

The app is a real client of the Application API. Nothing on the screen
is a fixture.

- **Opening a project opens a session.** The backend scans it and
  answers with the summary — the frameworks it recognized, how many
  endpoints, how many services. The app keeps the session id, so
  "this project is open" means a session exists, not that a folder name
  is on the screen. A failed open leaves the app **closed**, not
  half-open.
- **The endpoint list is the backend's list.** The filters — service,
  transport, auth, validation, framework, responses, confidence, source
  file, free text — are sent to the API, which answers with the
  matching page and the totals. The client walks the pages.
- **The detail panel asks for the endpoint.** `get-endpoint` and
  `get-schema` answer with the real spec: the transport, the auth
  scheme that was detected, the validation rules, the response
  statuses, and the file and line the route was found in.
- **The Export Center writes.** `dry-run` answers with the files that
  would be written, their size, and whether each would replace
  something that is already there; `export` writes them, atomically,
  into the chosen directory — the same directory the dry run looked at.
- **The five verbs that were CLI-only now answer.** `check` compares
  the collection with the routes in the code and says what is missing
  on either side; `validate` separates the errors from the warnings;
  `stats` counts the requests per method and per zone; `sync`
  generates and writes, or only says what it would write; `push`
  uploads the collection, with the key the app has saved — and the key
  does not come back.
- **The shell mounts every feature.** Overview, endpoints, exports,
  services, history, live, check, sync, validate, stats, push and
  settings are all reachable from the sidebar, and the ones that need
  a project say so instead of showing an empty screen.

## What the app cannot do yet

Five operations are asked for as **pending**:
`history-compare-config`, `history-diff`, `history-re-export`,
`history-restore` and `service-detail`. They are in
[`PENDING_APP_OPERATIONS`](../packages/contracts/constants/core/cli-app-parity.constant.ts),
not in the registry, and the app asks for them explicitly so the call
answers "not yet" instead of `UNKNOWN_HANDLER`.

They are all about the **persisted** history — the past generations,
with their hashes, that can be compared, re-exported or restored — and
about the detail of one service. The session's own events are
reachable from both faces; the persisted ones are not, because no
handler exposes them.

## What the CLI offers, action by action

Every row here is reachable from the app too. The verbs that used to
be CLI-only — `check`, `validate`, `push`, `stats` and `sync` — moved
their logic to the core, so both faces run **the same code** and not
two implementations that agree by accident.

| GUI action | CLI command | Output and diagnostics |
| --- | --- | --- |
| Check | `apisrc check --project-root <path>` | Drift report with exit code 0/1 and actionable diagnostics. The app shows the routes the collection is missing and the requests the code does not declare. |
| Sync | `apisrc sync --project-root <path>` | Uses the existing generation pipeline; `--dry-run` inspects without writing. The app reaches the same pipeline through `sync`, `export` and `dry-run`. |
| Validate | `apisrc validate --project-root <path>` | Schema/collection diagnostics and non-zero exit on errors. The app separates the errors from the warnings. |
| Push | `apisrc push --project-root <path> --workspace <id>` | Collection/environment actions; keys are never written to disk or diagnostics. The app sends the key it has saved, and the key does not come back. |
| Stats | `apisrc stats --project-root <path>` | Counts per method and per zone. The app shows the same numbers, because there is only one function that counts. |
| Live | `apisrc watch --project-root <path>` | Watches source changes; auto-export is opt-in and off by default. |

## Durable state diagnostics

State persistence is shadow-only and opt-in. A normal scan continues to use
the legacy in-memory result as its authority. Use `--shadow` to write the
complete snapshot to the SQLite state database without activating it:

```text
apisrc scan --project-root <path> --shadow
```

Use `doctor --json` (or run `packages/cli/commands/doctor.script.ts` directly
while the command is being exposed by the host) to inspect database version,
migration status, active snapshot, last write, corruption and parity
diagnostics. Secret values are never printed; the report only says that they
were omitted. An absent or unavailable database does not change scan behavior.

`sync` is a carrier over the existing generation handler. It does not scan or
export through a second pipeline. GUI dry-run, retry, cancellation and native
secure storage are host concerns around the same operation contract.