# CLI parity

The desktop and browser UI call the same application operations as the CLI.
The CLI remains the functional reference; GUI labels map to these commands.

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