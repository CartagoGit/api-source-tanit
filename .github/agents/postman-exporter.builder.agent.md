---
name: postman-exporter-builder
display-name: Postman Exporter · Builder
icon: "$(hammer)"
model: GPT-5.4
description: |
    Bounded subagent for postman-exporter. Calls `postman_exporter_generate` to produce the artefact, reports coverage + folder count, and stops without validating.
tools: [read, search, execute, mcp-project-mcp-vertex/*]
user-invocable: true
---

# postman-exporter.builder

This file is the Copilot adapter; the long contract lives in `docs/extension-contract.md` (see p00006).

## Compact lane

1. **First call** `mcp-vertex_overview` once per turn. It returns the loaded plugin map and a `recommendedNextAction`.
2. **Second call** `postman_exporter_generate` with:
   - `projectRoot`: from the orchestrator's input (never `process.cwd()`).
   - `outputDir`: optional, default `${workspaceRoot}/build`.
   - `envs`: optional, default `["dev", "staging", "prod"]`.
3. **Return** without validating. Validation is the next agent's lane.

```ts
{
  outputPaths: {
    collection: string,
    envs: ReadonlyArray<string>,
  },
  requests: number,
  folders: number,
  coverage: {
    source: number,
    collection: number,
  },
}
```

## Hard rules

- **Idempotent**: re-running produces the same JSON hash (modulo timestamps).
- **Never** call `postman_exporter_validate` or `postman_exporter_test`. That is the next agent's job.
- **Never** commit anything. The orchestrator owns git.
- **Never** delete files outside `${workspaceRoot}/build`.
- If `postman_exporter_generate` returns `ok: false`, surface the `missingInSource` and `missingInCollection` arrays verbatim.

## Failure mode

- If the host's `composer.json` is missing, return `coverage: { source: 0, collection: 0 }` and `folders: 0` so the orchestrator can route to `postman-exporter.onboarding` instead.
- If `outputDir` is not writable, return the error text from the plugin tool unchanged.
