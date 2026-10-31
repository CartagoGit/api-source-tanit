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

| Capability | CLI | Application API | Status |
| --- | --- | --- | --- |
| generate | `generate`, `sync` | `export`, `dry-run` | covered |
| detect | `scan`, `list` | `snapshot`, `list-endpoints`, `list-services`, `get-endpoint`, `get-schema` | partial |
| watch | `watch` | `watch`, `cancel` | covered |
| history | `history` | `history` | partial |
| drift | `check` | — | **gap** |
| validate | `validate` | — | **gap** |
| push | `push` | — | **gap** |
| stats | `stats` | — | **gap** |
| projects | — | `open-project`, `list-projects`, `close` | partial |
| settings | — | `settings` | partial |
| interface | `ui` | — | carrier |
| service | `serve` | — | carrier |

**A gap is not a bug in the map; it is the map doing its job.** The
honest thing is to write it down rather than pretend the two faces are
equal when they are not. Each gap says, in the map, what would have to
exist for the app to reach it.

## What the CLI offers, action by action

| GUI action | CLI command | Output and diagnostics |
| --- | --- | --- |
| Check | `apisrc check --project-root <path>` | Drift report with exit code 0/1 and actionable diagnostics. |
| Sync | `apisrc sync --project-root <path>` | Uses the existing generation pipeline; `--dry-run` inspects without writing. |
| Validate | `apisrc validate --project-root <path>` | Schema/collection diagnostics and non-zero exit on errors. |
| Push | `apisrc push --project-root <path> --workspace <id>` | Collection/environment actions; keys are never written to disk or diagnostics. |
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