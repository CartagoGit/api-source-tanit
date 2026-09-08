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

`sync` is a carrier over the existing generation handler. It does not scan or
export through a second pipeline. GUI dry-run, retry, cancellation and native
secure storage are host concerns around the same operation contract.